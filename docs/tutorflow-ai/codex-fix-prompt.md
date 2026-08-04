# Codex 修正投入プロンプト（レビュー指摘対応・ワンショット）

既存の TutorFlow AI v3 実装（commit `adbd642`）に対する修正依頼。
実装済みリポジトリを Codex に渡したうえで、以下のコードブロックを本文として投入する。

添付は不要（コード内に全情報を含めた）。参考資料として
`docs/tutorflow-ai/development-plan-v3.md` を渡してもよい。

---

```text
既存の TutorFlow AI 実装に対するレビューで7件の不具合が見つかりました。
すべて修正してください。途中で確認を求めず、最後まで一度で完了させてください。

## 最優先：作業前に必ずコミットできる状態を作る

過去2回、`.git/index.lock` の権限不足でコミットできず成果物を失いかけました。
**コードを1行も変更する前に**、次を実行してください。

    git status

これが権限エラーになる場合は、書き込み可能な場所へ移して作業を続けてください。

    cp -a . /tmp/work && cd /tmp/work && rm -rf .git
    git init && git add -A
    git -c user.email=dev@local -c user.name=dev commit -m "baseline before review fixes"

以降の作業は /tmp/work で行います。**この最初のコミットが作れないまま
修正に着手しないでください。**

作業完了後、コミットの可否にかかわらず必ず次を実行し、パスを報告してください。

    git bundle create /tmp/tutorflow-fixed.bundle --all
    ls -la /tmp/tutorflow-fixed.bundle

## 修正1【重大】デモリセット直後にレート制限が発動する

現状 `lib/demo-data.ts` の `buildDemoRows` が返す generation_runs 5件に
`created_at` がないため DB 既定値の now() になり、リセット直後に
「直近1時間の生成数 = 5」になります。デモ上限は3なので、リセットを押した
瞬間にAI生成が1時間使えなくなります。

同時に、デモデータの定義が `supabase/migrations/0003_seed.sql` と
`lib/demo-data.ts` の2箇所に重複しているのが原因です。**SQL 側に一本化して
`lib/demo-data.ts` を削除**してください。

### 1-a. 新規マイグレーション `supabase/migrations/0004_demo_seed_function.sql`

デモワークスペースを初期化する関数を作ります。SECURITY INVOKER（既定）の
ままにしてください。呼び出し元の RLS が効くため、デモアカウントは自分の行しか
消せません。

    create or replace function public.seed_demo_workspace(demo_id uuid)
    returns void
    language plpgsql
    as $$
    begin
      if not exists (select 1 from profiles p where p.id = demo_id and p.is_demo) then
        raise exception 'seed_demo_workspace requires a demo profile';
      end if;

      delete from generation_runs where owner_id = demo_id;
      delete from materials where student_id in (select id from students where owner_id = demo_id);
      delete from sessions  where student_id in (select id from students where owner_id = demo_id);
      delete from students  where owner_id = demo_id;

      -- 以下、既存の 0003_seed.sql にある students / sessions / materials /
      -- generation_runs の行データをそのまま移してください。
      -- ただし generation_runs の created_at は必ず過去日時にすること。
      -- （now() - interval '8 days' など。0003_seed.sql の値をそのまま使う）
      -- owner_id / student_id は demo_id と固定 UUID を使う。
    end;
    $$;

行データは既存の `0003_seed.sql` から**値を変えずに**移植してください。
`generation_runs` の `created_at` に過去日時が入っていることが、この修正の
本体です。ここを省略すると不具合が再発します。

### 1-b. `supabase/migrations/0003_seed.sql` を書き換える

profiles の作成と、関数の呼び出しだけにします。

    -- All demo data below is fictional. Created for portfolio demonstration only.
    -- No real student information is used.

    do $$
    begin
      if not exists (select 1 from auth.users where lower(email) = lower('demo@tutorflow.local')) then
        raise exception 'Demo auth user demo@tutorflow.local was not found. Create it in Supabase Auth first, or edit this file if DEMO_EMAIL differs.';
      end if;
    end $$;

    insert into profiles (id, display_name, is_demo)
    select id, 'TutorFlow Demo', true
    from auth.users
    where lower(email) = lower('demo@tutorflow.local')
    on conflict (id) do update set display_name = excluded.display_name, is_demo = true;

    select public.seed_demo_workspace(id) from profiles where is_demo order by created_at limit 1;

この `do $$ ... raise exception` ブロックが修正5も兼ねます（後述）。

### 1-c. `supabase/reset-demo.sql` を書き換える

    select public.seed_demo_workspace(id) from profiles where is_demo order by created_at limit 1;

### 1-d. `app/(app)/actions.ts` の `resetDemoData` を RPC 呼び出しにする

    "use server";

    import { revalidatePath } from "next/cache";
    import { requireProfile } from "@/lib/auth/guards";
    import { createActionDatabaseClient } from "@/lib/db/action";

    export async function resetDemoData() {
      const profile = await requireProfile();
      if (!profile.is_demo) throw new Error("demo_only");
      const db = await createActionDatabaseClient();
      const { error } = await db.rpc("seed_demo_workspace", { demo_id: profile.id });
      if (error) throw new Error("reset_failed");
      revalidatePath("/home");
      revalidatePath("/library");
    }

`lib/db/types.ts` の `Functions` を空のままにせず、この関数を追加してください。

    Functions: {
      seed_demo_workspace: { Args: { demo_id: string }; Returns: undefined };
    };

### 1-e. `lib/demo-data.ts` を削除

参照元がなくなることを確認してから削除してください。

**この修正で修正6（トランザクション欠如）も同時に解決します。** 削除と再投入が
1つの関数呼び出し＝1トランザクションになるためです。

## 修正2【重大】Vercel の関数タイムアウトで本番の生成が失敗する

`app/api/materials/generate/route.ts` に `maxDuration` の宣言がありません。
Vercel の既定タイムアウトは画面表示（30秒）より短く、本番だけ確実に失敗します。

ファイル先頭の import 群の直後に追加してください。

    export const maxDuration = 60;

あわせて README の Deployment 節に次を明記してください。

- この API ルートは実行に30秒前後かかること
- `maxDuration = 60` はプランの上限までしか効かないこと
- 上限に収まらない場合は環境変数 `AI_EFFORT=low` で短縮できること

## 修正3【重大】生成が失敗するとボタンが永久に無効のままになる

`components/MaterialGeneratorForm.tsx` の `submit` で、`response.json()` が
try/catch の外にあります。サーバーが JSON 以外（504 の HTML など）を返すと
例外で中断し、`setPending(false)` に到達せず、エラーも表示されません。

`submit` 関数全体を次に置き換えてください。

    async function submit(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setPending(true);
      setError(undefined);
      const form = new FormData(event.currentTarget);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 90_000);
      try {
        const response = await fetch("/api/materials/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            studentId,
            topic: form.get("topic"),
            difficulty: form.get("difficulty"),
            problemCount: Number(form.get("problemCount")),
            learningObjective,
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.materialId) {
          setError(payload?.error?.message ?? "教材を生成できませんでした。時間をおいて再試行してください。");
          return;
        }
        router.push(`/materials/${payload.materialId}`);
      } catch (error) {
        setError(
          error instanceof DOMException && error.name === "AbortError"
            ? "生成に時間がかかりすぎたため中断しました。問題数を減らすか、時間をおいて再試行してください。"
            : "通信に失敗しました。接続を確認して再試行してください。",
        );
      } finally {
        clearTimeout(timer);
        setPending(false);
      }
    }

要点は3つです。`finally` で `setPending(false)` を必ず実行すること、
`response.json()` を `.catch(() => null)` で保護すること、AbortController で
クライアント側のタイムアウトを持つこと。入力値は state に保持したままなので、
失敗しても内容は消えません（現状の挙動を変えないでください）。

## 修正4【中】Integration テスト2件が何も検証していない

`tests/integration/verification-gate.test.ts` の次の2件を修正します。

- `verifying twice is rejected by transition policy in the application`
  → `expect(true).toBe(true)` で常に通ります
- `demo rate limit blocks the 4th generation in an hour`
  → 環境変数の既定値を確認しているだけです

### 4-a. 「2回確認」は Unit へ移す

これはアプリ層の状態遷移規則であり DB 制約ではありません。integration からは
**削除**し、代わりに `tests/unit/material-state.test.ts` に次を追加してください。

    it("nextState rejects verified -> verified", () => {
      expect(() => nextState("verified", "verified")).toThrow();
    });

### 4-b. レート制限は実際に検証する

`checkGenerationLimit` を実際に呼ぶテストに置き換えてください。

    it("demo rate limit blocks the 4th generation in an hour", async () => {
      const db = admin();
      const demoId = process.env.SUPABASE_TEST_DEMO_ID!;
      await db.from("generation_runs").delete().eq("owner_id", demoId);
      for (let index = 0; index < 3; index += 1) {
        await db.from("generation_runs").insert({
          owner_id: demoId, model_label: "mock", prompt_version: "test",
          latency_ms: 1, success: true,
        });
      }
      await expect(
        checkGenerationLimit(db, { id: demoId, display_name: "Demo", is_demo: true, created_at: new Date().toISOString() }),
      ).rejects.toBeInstanceOf(RateLimitError);
      await db.from("generation_runs").delete().eq("owner_id", demoId);
    });

`checkGenerationLimit` と `RateLimitError` の import、および
`SUPABASE_TEST_DEMO_ID` を `.env.example` のテスト用変数一覧に追加してください。

### 4-c. 件数の表記を実態に合わせる

修正後の件数を数え直し、README とドキュメントの記載を実際の数に合わせて
ください。**実装していない件数を書かないこと。**

## 修正5【中】seed のデモメールがハードコードされている

`0003_seed.sql` は `demo@tutorflow.local` を固定で参照しています。
`.env` の `DEMO_EMAIL` が異なると profiles に0行入り、続く insert が外部キー
違反で失敗しますが、原因がメール不一致だと分かりません。

修正1-b の `do $$ ... raise exception ... end $$;` ブロックがこの対策です。
必ず含めてください。あわせて README のセットアップ手順に
「Auth ユーザーのメールアドレスは `demo@tutorflow.local` にすること。
変える場合は `0003_seed.sql` も編集すること」を明記してください。

## 修正6【中】resetDemoData にトランザクションがない

修正1-d で RPC 化することで解決済みです。追加作業は不要です。

## 修正7【低】レート制限のチェックと記録の間に競合窓がある

`app/api/materials/generate/route.ts` は「上限チェック → AI 呼び出し →
記録」の順なので、並行リクエストが全部チェックを通過します。また生成中に
プロセスが落ちると記録が残りません。

**先に記録行を作り、結果で更新する**方式に変えてください。

1. 上限チェックの直後、AI 呼び出しの前に `generation_runs` へ
   `success: false, validation_error: "pending"` の行を insert し、その id を保持する
2. 生成成功時は同じ行を
   `{ success: true, material_id, latency_ms, validation_error: null }` で update
3. 失敗時は同じ行を
   `{ success: false, latency_ms, validation_error: <エラーメッセージ> }` で update
4. 失敗パスでの新規 insert は削除する（行は1回の生成につき1行だけ）

既存の `console.error({ code, materialId, ownerId, latencyMs })` の
4フィールド構成は**変えないでください**。プロンプト本文と AI 応答本文を
ログに出さない制約も維持してください。

## 触ってはいけないもの（不変条件）

以下はレビューで正しいことを確認済みです。**変更・整形・リファクタリングを
しないでください。**

1. `supabase/migrations/0001_init.sql` の CHECK 制約3本、特に
   `materials_session_requires_verified`
2. `supabase/migrations/0002_rls.sql` のポリシー。匿名ロール向けポリシーを
   追加しないこと
3. `lib/ai/generate.ts` の `max_tokens: 16000`、`temperature` 不使用、
   `stop_reason === "refusal"` を content より先に判定、`parsed_output` の
   null チェック
4. `lib/ai/prompt.ts` の `buildUserPrompt` の引数（分野・難易度・問題数・
   学習目標の4つのみ）。学生情報を渡せる形にしないこと
5. `lib/db/types.ts` の既存テーブル定義（Functions の追加のみ可）
6. `MOCK_AI` のガード条件（`=== "1"` かつ `NODE_ENV !== "production"`）
7. 7項目チェックリストと `allChecked` によるボタン無効化
8. `/run/[materialId]` の未確認・破棄時 404

また、**このコードベースは JSX を1行に詰める書式で統一されています。
整形し直さないでください。** 差分は修正箇所だけに限定すること。

## 検証

各修正のあと、次をすべて実行して緑を保ってください。

    npm run lint
    npm run typecheck
    npm run test:unit
    npm run build

`npm run build` には `.env.local` に以下が必要です。

    NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
    SUPABASE_SERVICE_ROLE_KEY=placeholder
    ANTHROPIC_API_KEY=placeholder
    MOCK_AI=1

Integration と E2E は Supabase テスト環境がないため実行できません。
**コードは書くが実行しない**こと。skipIf のガードは維持してください。

修正4-a を入れると Unit は22件になります。全件通ることを確認してください。

## ドキュメントの更新

- README: Deployment 節（修正2）、セットアップ手順のメール注意（修正5）、
  テスト件数を実数に修正（修正4-c）
- `docs/data-model.md`: `seed_demo_workspace` 関数の説明を追加
- `DEVLOG.md` と `AI_USAGE.md` と `docs/ai-evaluation.md` は**触らないこと**
  （本人が書く領域です。日付入りの作業記録や評価結果を捏造しないでください）

## 最終報告に含めること

1. 最初のコミットが作れたかどうか、作業ディレクトリのパス
2. バンドルファイルのパスとサイズ
3. 修正1〜7それぞれの対応状況（完了 / 未完了と理由）
4. 実行して緑を確認したコマンドと、実行できなかったコマンドの区別
5. Unit テストの件数（22になっているか）
6. 指示と異なる判断をした箇所とその理由
7. 人間に残る作業（Supabase への 0004 マイグレーション適用、
   Integration/E2E の実行、Vercel のプラン確認）
```

---

## 投入後に人間が確認すること

1. `git bundle verify` してから展開する
2. `supabase/migrations/0004_demo_seed_function.sql` の
   `generation_runs` の `created_at` が**過去日時**になっているか目視
   （ここが修正1の本体。省略されやすい）
3. 既存 DB があるなら 0004 を適用し、`0003_seed.sql` を再実行
4. `app/api/materials/generate/route.ts` に `export const maxDuration = 60;` があるか
5. `npm run test:unit` が **22件**通るか
6. Supabase テスト環境を用意して `npm run test:integration` を実走
