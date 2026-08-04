# Codex 投入プロンプト（v3.0 対応）

添付する2文書とともに、以下をそのまま Codex に渡す。

- `docs/tutorflow-ai/development-plan-v3.md`（**実装対象。これに従う**）
- `docs/tutorflow-ai/source-plan-v1.md`（背景と動機。§1〜§5 と §16 のみ参照）

**`development-plan.md`（v2.0）は渡さない。** 学生ポータル前提の旧版で、
v3.0 に置き換えられている。

---

```text
TutorFlow AI という Web アプリを新規に実装してください。

実装対象は添付の「TutorFlow AI 詳細開発計画 v3.0（チューター専用ツール版）」
です。これが唯一の設計仕様です。もう一方の v1.0 は開発の背景と動機を知るための
参考資料で、§1〜§5 と §16 だけ読んでください。v1.0 に出てくる学生向け画面・
学生ログイン・外部公開の記述は v3.0 で廃止済みなので実装しないでください。

両方を通読してから着手してください。

## あなたのゴール

v3.0 §15 の D1-1 から D7-7 までを、途中で確認を求めずに一度で完了させる。
D8 以降（デプロイ・実 API 評価・面接準備）は人間の作業なので着手しない。

外部サービスの資格情報がなくても止まらず、後述の方針で実装を続けてください。

## このアプリの一行要約（実装中に見失わないこと）

チューター本人が使う授業準備ツール。AI が練習問題を下書きし、**本人が検算して
確認済みにするまでセッション記録に紐づけられない**。利用者は1人。学生は使わない。

判断に迷ったら「未検証の AI 出力を本人が誤って使わない構造になっているか」を
基準にしてください。

## 絶対に守る前提（推測で決めないこと）

| 項目 | 確定値 |
|---|---|
| Node.js | 22 LTS（`.nvmrc` に `22`） |
| Next.js | 15.x App Router、`src/` は使わない |
| TypeScript | 5.x、`strict: true`、`noUncheckedIndexedAccess: true` |
| Tailwind CSS | **4.x（CSS-first）**。`@import "tailwindcss";` と `@theme` を `app/globals.css` に書く。`tailwind.config.js` は作らない。PostCSS は `@tailwindcss/postcss` |
| Zod | **4.x**。`z.uuid()` / `z.iso.date()` のトップレベル形式 API（3系の `z.string().uuid()` は使わない） |
| Supabase | `@supabase/supabase-js` + `@supabase/ssr` |
| AI SDK | `@anthropic-ai/sdk`、モデルは `AI_MODEL`（既定 `claude-opus-5`） |
| テスト | Vitest 3.x、Playwright |
| パッケージマネージャ | npm。`package-lock.json` をコミット |

v3.0 §3.2 の非採用リスト（ORM、状態管理ライブラリ、tRPC、認証SaaS、KaTeX、
Redis）は導入しないでください。

## 資格情報がない前提での進め方

Supabase と Anthropic API には接続できないものとして進めます。

1. **DB 型定義は手書きする。** `supabase gen types` は使えないので、
   `0001_init.sql` の DDL から `lib/db/types.ts` を手で起こしてください。
   PostgreSQL の enum は TypeScript の union 型にします。

2. **マイグレーションは書くだけ。** `0001_init.sql` / `0002_rls.sql` /
   `0003_seed.sql` / `reset-demo.sql` を完成させます。適用は人間が行います。

3. **seed の中身はあなたが決める。** v3.0 §4.3 の条件を満たす具体的な INSERT を
   書いてください。デモアカウント配下にのみ作り、オーナーには何も入れません。
   ファイル先頭に §4.3 記載の英語コメント2行を必ず入れます。実在人物を
   想起させる名前・成績・相談内容は使わないこと。

4. **AI 呼び出しはモック可能にする。** `generateMaterialDraft()` の入口で
   `process.env.MOCK_AI === "1"` かつ `process.env.NODE_ENV !== "production"` の
   とき `lib/ai/mock.ts` の fixture を返します。fixture は正常1件と、
   異常3件（問題数不一致・難易度不一致・ヒント空配列）を用意してください。

5. **integration テストは書くが実行を強制しない。**
   `describe.skipIf(!process.env.SUPABASE_TEST_URL)` でガードします。
   ガードなしだと CI が落ちます。

6. **`npm run build` を通すため動的レンダリングを明示する。**
   `app/(app)/` と `app/run/` 配下のページに
   `export const dynamic = "force-dynamic";` を書いてください。これがないと
   ビルド時のプリレンダリングが Supabase へ接続しようとして失敗します。

## Supabase クライアントの構成（詰まりやすいので明示する）

Next.js 15 では `cookies()` が非同期です。v3.0 §7.1 のとおり3つに分けます。

- `lib/db/client.ts` — ブラウザ用。`createBrowserClient`
- `lib/db/server.ts` — Server Component 用。`createServerClient` + `await cookies()`。
  **Cookie 書き込みは try/catch で握りつぶす**（RSC からは書けない）。
  先頭に `import "server-only";`
- `lib/db/action.ts` — Server Action / Route Handler 用。Cookie 書き込み可

`SUPABASE_SERVICE_ROLE_KEY` を使うのは seed とテストユーティリティだけ。
アプリのリクエスト経路では絶対に使わないでください。

## 実装で絶対に外してはいけない4点

1. **確認ゲートは DB 制約で表現する。**
   `0001_init.sql` の
   `constraint materials_session_requires_verified check (session_id is null or state = 'verified')`
   を必ず入れてください。これがこのアプリの中核です。アプリ側のチェックだけで
   済ませないこと。Integration テストでこの制約が実際に効くことを検証します。

2. **RLS は所有者スコープ。** v3.0 §4.2 のポリシーをそのまま実装します。
   匿名ロール向けのポリシーは1つも書かないでください（デフォルト拒否を使う設計）。

3. **AI 呼び出しは v3.0 §9.2 のコードに従う。** 特に:
   - `max_tokens: 16000`（thinking と応答本文の合計上限）
   - `temperature` / `top_p` を**渡さない**（Opus 5 では 400 になる）
   - `content` を読む前に `stop_reason === "refusal"` を判定する
   - `parsed_output` が null になりうるので必ずチェックする
   - `system` は固定文字列にする（プロンプトキャッシュのため）

4. **`buildUserPrompt` は4引数だけ受け取る。** 分野・難易度・問題数・学習目標。
   学生の alias や private_notes を型として渡せない形にしてください。

## その他の実装注意

- 状態遷移は `unverified → verified` と `unverified → discarded` のみ。
  各 Server Action の冒頭で `if (material.state !== "unverified") throw` を書く
- 「確認済みにする」ボタンはチェックリスト7項目が全てチェックされるまで無効
- セッション記録の「使った教材」選択欄には `verified` の教材だけを出す
- `/run/[materialId]` は未確認・破棄済みの教材なら 404 を返す
- レート制限はオーナーとデモで別の上限（`profiles.is_demo` で分岐）
- `console.error` に出してよいのは `{ code, materialId, ownerId, latencyMs }` だけ。
  プロンプト本文と AI 応答本文はログに出さない
- 教材の状態は色だけでなく必ず文字で表示する（未確認 / 確認済み / 破棄）

## 実装順序

v3.0 §15 のチケット順（D1-1 → D7-7）。ただし D4-1（Zod スキーマ）と
D4-2（Unit テスト）は外部依存がないので D3 より先に着手して構いません。

UI プリミティブ（D3-2）は Button / Input / Textarea / Select / Badge / Card の
6つだけ。装飾に時間を使わないでください。

**出力量が足りなくなった場合に落としてよい順:**
(1) 教材ライブラリのフィルタ、(2) 理解度推移の表示、(3) Landing の作り込み。

**絶対に落とさないもの:** DB の3つの CHECK 制約、RLS ポリシー、AI 出力検証
（Zod + `assertMatchesRequest`）、Material Review 画面、セッションモード。

## 各段階で必ず実行するコマンド

チケット群ごとに実行して緑を保ってください。

    npm run lint
    npm run typecheck
    npm run test:unit
    npm run build

`npm run build` にはプレースホルダの環境変数が必要です。`.env.local` に以下を
置いてください（`.gitignore` 済みであること）。

    NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
    SUPABASE_SERVICE_ROLE_KEY=placeholder
    ANTHROPIC_API_KEY=placeholder
    MOCK_AI=1

E2E は `MOCK_AI=1` でも DB が必要なので、テストコードは書くが実行しなくて
構いません。実行できなかったことを最終報告に明記してください。

## コミットについて

**作業の早い段階で一度コミットしてください。** 前回の実装では最後まで
コミットせずに終わり、`.git/index.lock` の権限問題で成果物を取り出せなく
なりました。D1 が終わった時点で最初のコミットを作り、以降チケット群ごとに
コミットしてください。

コミットできない環境だと分かった場合は、**その時点で作業を止めずに続行し、
最終報告の冒頭にその事実を書いてください。**

## 作ってよいドキュメントと、作ってはいけないドキュメント

**あなたが書くもの:**
- `README.md` — v3.0 §16 の構成。ただし後述の正直さルールに従う
- `docs/architecture.md` / `docs/data-model.md` — Mermaid 図を含む。
  data-model.md には3つの CHECK 制約の意図を必ず書く
- `AGENTS.md` — 確定したスタック・制約・実行コマンドを次のセッション用にまとめる

**雛形だけ作り、中身を書かないもの:**
- `DEVLOG.md` — 見出しと書式だけ。**日付入りの作業記録を捏造しない**
- `AI_USAGE.md` — 節見出しだけ
- `docs/ai-evaluation.md` — v3.0 の評価表の枠だけ。**採点結果を埋めない**
  （実 API で評価していないため）

### README の正直さルール

実行して緑を確認したものと、書いただけのものを区別して書いてください。

- 未実行のテスト（integration / e2e）は「実装済み・未実行」と明記する
- 外部接続を伴う機能は「ローカル環境では未検証」と明記する
- Definition of Done（v3.0 §19）の18項目のうち、達成していないものに
  チェックを入れない

動かしていないものを「動く」と書かないこと。この作品の主張（AI の出力を
検証せずに信用しない）と直接矛盾するため、最も重要な制約です。

## 最終報告に必ず含めること

1. コミットできたかどうか（できていない場合は冒頭に明記）
2. 完了したチケット ID の一覧
3. 着手しなかった / 完了できなかったチケットと理由
4. **実行して緑を確認したコマンドと、実行できなかったコマンドの区別**
5. 人間が実行する必要が残っている作業（マイグレーション適用、
   オーナー/デモアカウント作成、`supabase gen types` での型再生成、
   Anthropic キー設定、実 API での生成確認）
6. v3.0 と食い違った箇所とその判断理由
7. 手書きした `lib/db/types.ts` が DDL と一致していることをどう確認したか
```

---

## 投入後に人間がやること

1. **まず成果物を手元に取り出す**（コミットの有無を確認）
2. Supabase dev / test プロジェクトにマイグレーション3本を適用
3. オーナーとデモの Auth ユーザーを作り、`profiles` 行を作成（デモは `is_demo = true`）
4. `supabase gen types` を実行し、手書きの `lib/db/types.ts` と**差分を確認**。
   差分があれば手書き側の誤りなので生成物で置き換える
5. `MOCK_AI=0` にして実 API で1件生成し、`generation_runs` に記録が残ることを確認
6. `npm run test:integration` を実行。**特に
   `db rejects linking an unverified material to a session` が通ることを確認**
7. `npm run test:e2e` を実行
8. Vercel へデプロイ
9. **自分の担当セッションで実際に使い始める**（Definition of Done 16番）

`DEVLOG.md` / `AI_USAGE.md` / `docs/ai-evaluation.md` は雛形のままなので自分で
埋める。特に AI 評価は、架空条件で回した結果より**実務で AI が誤った実例**を
優先して記録する。ここが面接での説明材料になる。
