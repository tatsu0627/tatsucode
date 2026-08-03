# Codex 投入プロンプト

添付する2文書とともに、以下をそのまま Codex に渡す。

- `docs/tutorflow-ai/source-plan-v1.md`（製品要件）
- `docs/tutorflow-ai/development-plan.md`（詳細設計・43チケット）

---

```text
TutorFlow AI という Web アプリを新規に実装してください。要件は添付の
「TutorFlow AI ポートフォリオ開発計画 v1.0」、設計とチケット一覧は
「TutorFlow AI 詳細開発計画 v2.0」にあります。両方を最初に通読してから
着手してください。

## あなたのゴール

詳細計画 §13 の D1-1 から D7-6 までを、途中で確認を求めずに一度で完了させる。
D8 以降（デプロイ・AI評価・面接準備）は人間の作業なので着手しない。

作業を止めてよいのは、外部サービスの資格情報がないと物理的に先へ進めない
ときだけです。その場合も止まらず、後述の「資格情報がない前提での進め方」に
従って実装を続けてください。

## 絶対に守る前提（推測で決めないこと）

| 項目 | 確定値 |
|---|---|
| Node.js | 22 LTS（`.nvmrc` に `22`） |
| Next.js | 15.x App Router、`src/` ディレクトリは使わない |
| TypeScript | 5.x、`strict: true`、`noUncheckedIndexedAccess: true` |
| Tailwind CSS | **4.x（CSS-first）**。`@import "tailwindcss";` と `@theme` を `app/globals.css` に書く。`tailwind.config.js` は作らない。PostCSS は `@tailwindcss/postcss` |
| Zod | **4.x**。`z.uuid()` / `z.iso.date()` のトップレベル形式 API を使う（3系の `z.string().uuid()` は使わない） |
| Supabase | `@supabase/supabase-js` + `@supabase/ssr` |
| AI SDK | `@anthropic-ai/sdk`、モデルは環境変数 `AI_MODEL`（既定 `claude-opus-5`） |
| テスト | Vitest 3.x（unit / integration）、Playwright（e2e） |
| パッケージマネージャ | npm。`package-lock.json` をコミットする |

詳細計画 §1.2 に「採用しないもの」があります。ORM、状態管理ライブラリ、
tRPC、認証SaaS、KaTeX は導入しないでください。

## 資格情報がない前提での進め方

Supabase と Anthropic API には接続できないものとして進めます。以下の
方針で「コードは完成しているが、外部接続だけ未検証」の状態にしてください。

1. **DB 型定義は手書きする。** `supabase gen types` は実行できないので、
   `supabase/migrations/0001_init.sql` の DDL から `lib/db/types.ts` を
   手で起こしてください。enum は TypeScript の union 型にします。

2. **マイグレーションは書くだけ。** `0001_init.sql` / `0002_rls.sql` /
   `0003_seed.sql` と `supabase/reset-demo.sql` を完成させます。適用は
   人間が行います。SQL は PostgreSQL 16 の構文で書き、手元で構文の
   自己レビューをしてください。

3. **seed の中身はあなたが決める。** 詳細計画 §4.3 の条件（架空学生3名、
   セッション6件、教材は draft / approved / rejected を各1件以上、学生C は
   セッション0件）を満たす具体的な INSERT 文を書いてください。実在人物を
   想起させる名前・成績・相談内容を使わないこと。ファイル先頭に
   §4.3 記載の英語コメント2行を必ず入れます。

4. **AI 呼び出しはモック可能にする。** `lib/ai/generate.ts` の
   `generateMaterialDraft()` の入口で、`process.env.MOCK_AI === "1"` かつ
   `process.env.NODE_ENV !== "production"` のとき `lib/ai/mock.ts` の
   固定 fixture を返すようにしてください。fixture は
   `materialDraftSchema` を通る正常データ1件と、検証に失敗する異常データ
   （問題数不一致・難易度不一致・ヒント空）を3件用意します。

5. **integration テストは書くが実行を強制しない。**
   `describe.skipIf(!process.env.SUPABASE_TEST_URL)` でガードしてください。
   ガードなしで書くと CI が落ちます。

6. **`npm run build` を通すために動的レンダリングを明示する。**
   認証や DB アクセスを伴うページ（`(tutor)` と `(student)` 配下すべて）に
   `export const dynamic = "force-dynamic";` を書いてください。これがないと
   ビルド時のプリレンダリングが Supabase へ接続しようとして失敗します。

## Supabase クライアントの構成（詰まりやすいので明示する）

Next.js 15 では `cookies()` が非同期です。以下3つを別ファイルで実装します。

- `lib/db/client.ts` — ブラウザ用。`createBrowserClient`
- `lib/db/server.ts` — Server Component 用。`createServerClient` +
  `await cookies()`。**Cookie の書き込みは try/catch で握りつぶす**
  （RSC からは書けないため）。先頭に `import "server-only";`
- `lib/db/action.ts` — Server Action / Route Handler 用。Cookie 書き込み可能

`SUPABASE_SERVICE_ROLE_KEY` を使うのは seed とテストのユーティリティだけに
限定し、アプリのリクエスト経路では絶対に使わないでください。

## 実装順序

詳細計画 §13 のチケット順（D1-1 → D7-6）で進めてください。ただし以下の
2点だけ順序を変えます。

- D4-1（Zod スキーマ）と D4-2（Unit テスト）は D3 より先に着手してよい。
  外部依存がなく、他の実装の土台になるため。
- UI プリミティブ（D3-2）は最小限にする。Button / Input / Textarea /
  Select / Badge / Card の6つだけ。装飾に時間を使わない。

**時間や出力量が足りなくなった場合の優先順位:**
落としてよい順に、(1) P1 相当の磨き込み、(2) Dashboard の集計表示、
(3) 学生詳細の進捗表示。**RLS ポリシー、AI 出力検証、承認フローの
状態遷移制約、Material Review 画面は絶対に落とさないでください。**
これらがこの作品の中身です。

## 各段階で必ず実行するコマンド

まとめて最後に走らせるのではなく、チケット群ごとに実行して緑を保ってください。

    npm run lint
    npm run typecheck
    npm run test:unit
    npm run build

`npm run build` にはプレースホルダの環境変数が必要です。
`.env.local` に以下を置いて実行してください（`.gitignore` 済みであること）。

    NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
    SUPABASE_SERVICE_ROLE_KEY=placeholder
    ANTHROPIC_API_KEY=placeholder
    MOCK_AI=1

E2E は `MOCK_AI=1` でも DB が必要なので、**テストコードは書くが実行は
しなくて構いません。** 実行できなかったことを最終報告に明記してください。

## 実装で特に注意する箇所

1. **RLS が権限管理の中核です。** 詳細計画 §4.2 のポリシーをそのまま
   実装してください。特に `sessions` テーブルには学生向けポリシーを
   **書かない**でください（デフォルト拒否を利用する設計です）。

2. **学生向けクエリは列を限定する。** `materials.ai_draft` は approved 行でも
   RLS では防げません。`lib/db/queries/materials.ts` の
   `getApprovedMaterialsForStudent()` で `select` する列を
   `id, topic, difficulty, approved_content, approved_at` に限定し、
   `toStudentView()` で変換してください。§11.1 の Unit テストで
   `ai_draft` と `rejection_reason` が返り値に含まれないことを検証します。

3. **AI 呼び出しの実装は詳細計画 §8.2 のコードに従う。** 特に以下4点:
   - `max_tokens: 16000`（thinking と応答本文の合計上限）
   - `temperature` / `top_p` は**渡さない**（Opus 5 では 400 になる）
   - `content` を読む前に `stop_reason === "refusal"` を判定する
   - `parsed_output` が null になりうるので必ずチェックする

4. **構造検証を通っても要求と一致するとは限らない。** §6.3 の
   `assertMatchesRequest()`（問題数・難易度の一致確認）を必ず実装し、
   Unit テストで両方の不一致ケースを検証してください。

5. **承認ボタンはチェックリスト7項目が全てチェックされるまで無効。**
   これは UI の飾りではなく製品原則の実装です（§9.7）。

6. **状態遷移は draft からのみ。** `approveMaterial` / `rejectMaterial` の
   両 Server Action の冒頭で `if (material.status !== "draft") throw` を
   書いてください。

7. **エラーログに個人情報を残さない。** `console.error` に出してよいのは
   `{ code, materialId, tutorId, latencyMs }` だけです。プロンプト本文と
   AI 応答本文はログに出さないでください。

## 作ってよいドキュメントと、作ってはいけないドキュメント

**あなたが書くもの:**
- `README.md` — 詳細計画 §22 の構成。ただし後述の正直さルールに従う
- `docs/architecture.md` / `docs/data-model.md` — Mermaid 図を含む
- `AGENTS.md` — このプロンプトで確定したスタックと制約、実行コマンドを
  次のセッションが読めるようにまとめたもの

**雛形だけ作り、中身を書かないもの:**
- `DEVLOG.md` — 見出しと書式だけ。**日付入りの作業記録を捏造しない**
- `AI_USAGE.md` — 節見出しだけ。中身は人間が書く
- `docs/ai-evaluation.md` — 詳細計画 §14.2 の表の枠だけ。**採点結果を
  埋めない**（実 API で評価していないため）

### README の正直さルール（重要）

実行して緑を確認したものと、書いただけのものを区別して書いてください。

- 実行できていないテスト（integration / e2e）は「実装済み・未実行」と明記する
- 外部接続を伴う機能は「ローカル環境では未検証」と明記する
- Definition of Done（§18）の16項目のうち、達成できていないものに
  チェックを入れない

動かしていないものを「動く」と書かないこと。これはこの作品の主張
（AI の出力を検証せずに信用しない）と直接矛盾するため、最も重要な制約です。

## コミット

詳細計画 §19 のコミット計画に沿って分割してください。1つの巨大な
コミットにしないこと。各コミットは lint / typecheck / test:unit が
通る状態にしてください。

## 最終報告に必ず含めること

1. 完了したチケット ID の一覧（D1-1 〜 D7-6 のうちどれを終えたか）
2. 着手しなかった / 完了できなかったチケットとその理由
3. **実行して緑を確認したコマンドと、実行できなかったコマンドの区別**
4. 人間が実行する必要が残っている作業の手順（Supabase へのマイグレーション
   適用、デモアカウント作成、`supabase gen types` による型の再生成、
   Anthropic API キー設定、初回の実 API 生成確認）
5. 実装中に詳細計画と食い違った箇所と、その判断理由
6. 手書きした `lib/db/types.ts` が DDL と一致していることをどう確認したか
```

---

## 投入後に人間がやること

Codex が終わったら以下を順に実施する。詳細計画 §13 の D8 に対応。

1. Supabase dev プロジェクトにマイグレーション3本を適用
2. デモアカウント2つを作成し `profiles` 行を挿入
3. `supabase gen types` を実行し、手書きの `lib/db/types.ts` と**差分を確認**
   （差分があれば手書き側の誤りなので、生成物で置き換える）
4. `MOCK_AI` を外して実 API で1件生成し、`generation_runs` に記録が残ることを確認
5. integration テストと E2E をローカルで実行
6. Vercel へデプロイ

`DEVLOG.md` / `AI_USAGE.md` / `docs/ai-evaluation.md` は雛形のままなので、
自分で埋める。ここが面接での説明の材料になる。
