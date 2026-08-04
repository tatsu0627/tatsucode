# Codex 投入プロンプト（v4.0 設計変更・ワンショット）

**渡すもの**

- 実装済みリポジトリ（v3、commit `652bf8a` 相当）
- `docs/tutorflow-ai/development-plan-v4.md`（**実装対象**）
- `docs/tutorflow-ai/development-plan-v3.md`（v4 が「変更なし」として参照する章がある。必須）

v1 と v2 の計画書は渡さない。

---

```text
既存の TutorFlow AI 実装に対する設計変更です。添付の「詳細開発計画 v4.0
（Drop-in 診断ツール版）」に従って改修してください。途中で確認を求めず、
最後まで一度で完了させてください。

v3.0 の計画書も添付しています。v4.0 が「v3 から変更なし」と書いている章
（§3 技術構成、§6 環境変数、§7.1 Supabase クライアント構成、§9 AI 連携の
実装注意）はそちらを参照してください。v3 のそれ以外の章は無効です。

## 最優先：作業前に必ずコミットできる状態を作る

過去3回、`.git/index.lock` の権限不足でコミットできませんでした。
**コードを1行も変更する前に**次を実行してください。

    git status

権限エラーになる場合は書き込み可能な場所へ移して作業します。

    cp -a . /tmp/work && cd /tmp/work && rm -rf .git
    git init && git add -A
    git -c user.email=dev@local -c user.name=dev commit -m "baseline before v4 redesign"

**この最初のコミットが作れないまま改修に着手しないでください。**

完了後、コミットの可否にかかわらず必ずバンドルを作り、パスを報告してください。

    git bundle create /tmp/tutorflow-v4.bundle --all
    ls -la /tmp/tutorflow-v4.bundle

## この改修の目的（見失わないこと）

Drop-in のチュータリングでは、学生が「二次方程式が分からない」と言っても、
実際の詰まりどころは2段階下（符号の扱いなど）にあることが多い。概念の前提
関係をたどって根本原因を特定し、各段階で確認問題を出す。**その問題は
チューターが検算した確認済みのものしか学生に見せられない。**

判断に迷ったら「未検算の AI 出力が学生の目に触れない構造になっているか」を
基準にしてください。

## 絶対に触ってはいけないもの

以下はレビューで検証済みです。**変更・整形・リファクタリングをしないでください。**

1. `app/(app)/materials/[id]/page.tsx`
2. `components/MaterialReview.tsx` / `MaterialDiff.tsx` / `ProblemEditor.tsx` /
   `VerifyChecklist.tsx`
3. `components/SessionRunner.tsx` / `HintDisclosure.tsx` と `app/run/`
4. **`lib/ai/generate.ts` の既存 `generateMaterialDraft` の呼び出し方**
   （`max_output_tokens`、reasoning effort、拒否判定、`status === "incomplete"`
   の判定、`output_parsed` の null チェック、エラー分類）— 実 SDK の型に対して
   検証済みです。新しい関数を**追加**するのは可、既存を書き換えるのは不可
5. `lib/ai/prompt.ts` の既存 `SYSTEM_PROMPT` と `buildUserPrompt`
6. `supabase/migrations/0001_init.sql` 〜 `0005_openai_luna.sql`
   （**新しい番号のファイルを足す**こと。既存を編集しない）
7. `lib/auth/`、`lib/db/client.ts` / `server.ts` / `action.ts`
8. `vitest.config.ts` と `tests/stubs/server-only.ts`
9. `MOCK_AI` のガード条件（`=== "1"` かつ `NODE_ENV !== "production"`）

また、**このコードベースは JSX を1行に詰める書式で統一されています。整形し
直さないでください。** 差分は改修箇所だけに限定すること。

## 実装順序

計画 §11 のチケット順（R1-1 → R7-5）で進めてください。ただし **R2（診断
エンジン）は DB も UI も不要な純関数なので、R1 より先に着手して構いません。**

出力量が足りなくなった場合に落としてよい順:
(1) `/library` のフィルタ拡張、(2) `/home` の未整備概念カウント、
(3) `/concepts` の編集機能（読み取り専用にする）。

**絶対に落とさないもの:** `0007_probes.sql` の複合外部キーと CHECK、
診断エンジンとその Unit テスト、`/diagnose` 画面、RLS ポリシー。

## 特に正確に実装してほしい3点

### 1. 検算ゲートの複合外部キー（`0007_probes.sql`）

これが v4.0 の主張の本体です。**この形のまま書いてください。**

    alter table materials add column concept_id uuid references concepts(id) on delete set null;
    alter table materials add column kind material_kind not null default 'practice';
    create index materials_concept_kind_idx on materials (concept_id, kind, state);

    -- 複合外部キーの参照先として (id, state) に一意制約を張る
    alter table materials add constraint materials_id_state_key unique (id, state);

    create table probes (
      id              uuid primary key default gen_random_uuid(),
      consultation_id uuid not null references consultations(id) on delete cascade,
      concept_id      uuid not null references concepts(id) on delete cascade,
      material_id     uuid not null,
      material_state  material_state not null default 'verified',
      result          probe_result not null,
      step            smallint not null check (step between 1 and 20),
      created_at      timestamptz not null default now(),

      constraint probes_material_must_be_verified check (material_state = 'verified'),
      constraint probes_material_fk foreign key (material_id, material_state)
        references materials (id, state) on update cascade,

      unique (consultation_id, step)
    );

`material_state` 列を「冗長だから」と削らないでください。**この列と CHECK と
複合 FK の3点セットで初めて「確認済み教材しか参照できない」が成立します。**
`on update cascade` も必須です（教材を未確認に戻せなくする仕掛け）。

### 2. 診断エンジン（`lib/diagnosis/engine.ts`）

**DB にも React にも依存しない純関数**として書いてください。import してよいのは
型定義だけです。計画 §5.2 のシグネチャをそのまま使ってください。

伝播規則（§5.3）が探索回数を減らす本体です。

- `solved` → その概念の**前提すべて**を推移的に `solved` にする
- `failed` → その概念に**依存する側**を推移的に `failed` にする
- `skipped` → 伝播しない

`nextProbe` は「候補のうち `unknown` なものの中から、`depthMap` の中央値に
最も近いノード」を返します。**同点のときは concept id の辞書順で安定させて
ください**（テストの再現性のため）。

`rootBlocker` は「`failed` かつ直接の前提がすべて `solved`（または前提なし）」
を満たす概念のうち、**最も深いもの**を返します。

### 3. デモデータの `generation_runs` は必ず過去日時にする

`0010_demo_v4.sql` で `seed_demo_workspace` を書き換えます。**`generation_runs`
の `created_at` に `now() - interval '8 days'` のような過去日時を必ず入れて
ください。** 現在時刻にすると、デモをリセットした瞬間にレート制限が発動して
AI 生成が1時間使えなくなります（v3 で実際に起きた不具合です）。

§3.3 の概念18ノードとエッジも、この関数の中で投入してください。

## マイグレーションの順序

**0006 → 0007 → 0008 → 0009 → 0010 の順で作成してください。**
0008 で `sessions` テーブルを落とすので、0007（`materials` の列追加）より
後に置くこと。既存の 0001〜0005 は編集しません。

`lib/db/types.ts` は手書きです。新しい4表と2つの enum（`material_kind`、
`probe_result`）を追加し、`sessions` の定義を削除して `consultations` に
置き換えてください。`materials` には `concept_id` と `kind` を足します。

## 新しい画面

計画 §7 に従ってください。特に `/diagnose`（§7.2）が中核です。

- **未確認のプローブを学生表示領域に出さない**こと
- 該当概念の確認済みプローブがない場合は「生成する」ボタンを出し、押したら
  レビュー画面へ遷移させる（検算を経ずに表示させない）
- 診断の途中経過は `consultations` と `probes` に都度保存し、ブラウザを閉じても
  復元できるようにする
- プローブが5回を超えたら「絞り込みが進んでいません」と警告を出す

`/sessions/new` と `/sessions/[id]/edit` は削除し、`/consultations` と
`/consultations/[id]` に置き換えます。

## AI プローブ生成

`lib/validation/probe-output.ts` に `probeDraftSchema` を新規作成（計画 §6.2）。
`lib/ai/prompt.ts` に `PROBE_SYSTEM_PROMPT` と `buildProbePrompt` を**追加**
（既存の定数は変更しない、計画 §8.2）。

`generateProbeDraft` は既存の `generateMaterialDraft` と**同じ構造**で書いて
ください。違いはスキーマとプロンプトだけです。要求一致検証は
`draft.concept_code === request.conceptCode` を確認します。

**`buildProbePrompt` は概念コードと英語ラベルの2引数だけ**にしてください。
学生情報を型として渡せない形を維持します。

プローブ生成も既存のレート制限の対象に含めてください。

## テスト

計画 §10 のケース名をそのまま使ってください。

- Unit: 既存22件 + 新規16件 = **38件**
  （`diagnosis-engine.test.ts` 10件、`graph.test.ts` 3件、
   `probe-output.test.ts` 3件。`session-validation.test.ts` は
   `consultation-validation.test.ts` にリネームして調整）
- Integration: **15件**（`describe.skipIf(!process.env.SUPABASE_TEST_URL)` を維持）
- E2E: `tests/e2e/diagnose.spec.ts` 1本

Integration の最初の3件が v4.0 の中核の証明です。必ず実装してください。

    db rejects a probe referencing an unverified material
    db rejects a probe referencing a discarded material
    db rejects un-verifying a material that a probe references

Integration と E2E は Supabase テスト環境がないため**実行しません**。
コードは書くが実行しないこと。

## 各段階で必ず実行するコマンド

    npm run lint
    npm run typecheck
    npm run test:unit
    npm run build

`npm run build` には `.env.local` が必要です。

    NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
    SUPABASE_SERVICE_ROLE_KEY=placeholder
    OPENAI_API_KEY=placeholder
    MOCK_AI=1

**`npm run test:integration` も実行して exit 0 を確認してください。**
全件 skip で正常終了するのが期待値です。収集エラーで落ちる場合は import が
`server-only` を巻き込んでいます。

## ドキュメント

- `README.md`: 診断フローの説明に差し替え。**実行して緑を確認したものと、
  書いただけのものを区別して書く**こと。未実行のテストは「実装済み・未実行」
  と明記する
- `docs/architecture.md` と `docs/data-model.md`: v4 の構成に更新。
  data-model.md には**複合外部キーの意図**を必ず書く
- `AGENTS.md`: 更新可
- **`DEVLOG.md` / `AI_USAGE.md` / `docs/ai-evaluation.md` は触らないこと。**
  日付入りの作業記録や評価結果を捏造しないでください

## 最終報告に含めること

1. 最初のコミットが作れたか、作業ディレクトリのパス
2. バンドルのパスとサイズ
3. 完了したチケット ID（R1-1 〜 R7-5）
4. 未完了のチケットと理由
5. 実行して緑を確認したコマンドと、実行できなかったコマンドの区別
6. Unit テストの件数（38になっているか）と Integration の件数（15か）
7. 計画と異なる判断をした箇所とその理由
8. 「触ってはいけないもの」に挙げた9項目に変更を加えていないことの確認
```

---

## 戻ってきたら確認すること

1. `git bundle verify` してから展開
2. **`0007_probes.sql` に `material_state` 列・CHECK・複合 FK・`on update cascade`
   の4点が揃っているか**（v4 の本体。省略されやすい）
3. `0010_demo_v4.sql` の `generation_runs` が**過去日時**か
4. `lib/diagnosis/engine.ts` が DB / React を import していないか
5. `npm run test:unit` が **38件**、`npm run test:integration` が **exit 0**
6. `git diff` で Material Review と `lib/ai/generate.ts` の既存関数が無変更か
7. `DEVLOG.md` / `AI_USAGE.md` / `docs/ai-evaluation.md` に差分がないか
