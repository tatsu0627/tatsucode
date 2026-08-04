# TutorFlow AI 詳細開発計画 v3.0（チューター専用ツール版）

**版:** 3.0
**作成日:** 2026年8月3日
**位置づけ:** v2.0（学生ポータル前提）を**破棄して置き換える**。実装はこの文書に従う
**前提資料:** `source-plan-v1.md`（製品の背景と動機。§1〜§5 と §16 は引き続き有効）

---

## 0. v2.0 からの方針転換

### 0.1 何が変わったか

学生向けの画面とログインを**廃止**し、チューター本人だけが使う道具にする。

| | v2.0 | v3.0 |
|---|---|---|
| 利用者 | チューター + 学生（2ロール） | チューター本人のみ（1ロール） |
| 承認の意味 | 学生に公開してよいか | **自分がセッションで使ってよいか** |
| 承認の強制 | RLS で学生から draft を隠す | **DB制約で未確認教材をセッションに紐づけさせない** |
| 権限モデル | tutor / student の可視範囲 | **所有者スコープ（実データとデモデータの分離）** |
| 段階ヒント | 学生が自分で開く | **授業中に自分が1つずつ提示する** |
| データ | すべて架空 | 実運用は alias、公開デモは架空 |

### 0.2 転換の理由（面接で聞かれる想定）

学生ポータルは実際のチューター業務に存在しなかった。架空の利用者のために画面を
作るより、**自分が実際に使い、AI が誤った実例を記録する**ほうが作品として強い。

承認という概念は残る。「学生に公開してよいか」ではなく「検算したから授業で
使ってよいか」に定義し直せば、利用者が1人でも成立する。数学の問題を検算せずに
学生の前に出せばその場で信用を失う。この結果は共有機能の有無と無関係に実在する。

### 0.3 v2.0 の実装成果の扱い

Codex が v2.0 で作った成果はコミットされていない。**本計画は新規実装として書く。**
手元に残っている場合、以下は流用できる。

| 流用可 | 破棄 |
|---|---|
| `lib/validation/ai-output.ts` と Unit テスト9件 | `app/(student)/` 一式 |
| `lib/validation/session.ts` と Unit テスト7件 | 学生デモログイン |
| `lib/ai/` 一式（プロンプト・生成・検証・レート制限） | `student_viewers` 表と関連 RLS |
| `HintDisclosure`（用途が変わるだけ） | 学生向け RLS ポリシー |
| UI プリミティブ、状態コンポーネント | — |

---

## 1. 製品定義

### 1.1 一文

数学チューターである自分が、学生ごとの学習記録をつけ、次回の練習問題を AI に
下書きさせ、**自分で検算してからでないとセッションに持ち込めない**ようにした、
個人用の授業準備ツール。

### 1.2 中核となる制約

> **未確認の AI 出力は、セッション記録に紐づけられない。**

これをアプリのバリデーションではなく **DB の CHECK 制約**で表現する（§4.1）。
この1行が作品の主張そのものであり、最も説明価値のある実装箇所。

### 1.3 利用サイクル

```
  セッション前                  セッション中            セッション後
 ┌─────────────┐           ┌─────────────┐      ┌─────────────┐
 │ 学生を開く   │           │ セッション   │      │ 記録を書く   │
 │ 前回記録と   │           │ モードで     │      │ 理解度 1-5   │
 │ 次回目標を見る│           │ 問題を表示   │      │ つまずいた点 │
 │     ↓       │           │             │      │ 次回の目標   │
 │ AIに生成させる│  ────→   │ ヒントを1つ  │ ───→ │     ↓       │
 │     ↓       │           │ ずつ提示     │      │ 使った教材を │
 │ 検算・修正   │           │             │      │ 記録に紐づけ │
 │ → 確認済み   │           │             │      │     ↓       │
 └─────────────┘           └─────────────┘      │ 次回目標が   │
        ↑                                        │ 次の生成条件 │
        └────────────────────────────────────────┴─────────────┘
```

`sessions.next_goal` が次回の `materials` 生成条件になる。ループが閉じているため
記録を書く動機が生まれ、AI が的外れな問題を作りにくくなる。

### 1.4 作らないもの

学生用ログイン、外部共有リンク、成績管理、自動採点、チャットボット、
学校システム連携、実在学生の個人情報管理、課金、モバイルアプリ、
AIモデルのファインチューニング。

**特にチャットボットではない。** 「学生が AI に何でも聞ける」の逆で、
「AI の出力を人が検査してから使う」アプリ。

---

## 2. アカウント構成と実データ運用ルール

### 2.1 アカウントは2つ

| アカウント | 用途 | データ |
|---|---|---|
| オーナー | 本人が実務で使う | alias 化した実在の担当学生 |
| デモ | ポートフォリオ来訪者が触る | 完全な架空データ |

公開 URL に置く以上、**デモで触った人がオーナーの実データを見られては困る。**
つまり所有者スコープの RLS はデモ用の演出ではなく本物のセキュリティ要件になる。
§11.2 の Integration テストで検証する。

### 2.2 デモアカウントの扱い

- 書き込みを許可する（生成と確認のフローを実際に試せないとデモの意味がない）
- 生成回数の上限をオーナーより厳しくする（オーナー 20回/時、デモ 3回/時）
- 画面上に「デモデータをリセット」ボタンを置く
- `profiles.is_demo = true` で識別する

### 2.3 実データ運用ルール（オーナーアカウント）

DVC は米国の大学であり学生記録の扱いに規制がある。以下を守る。

- **入れてよい:** alias（`木曜3限のA`、`Student A` 等）、分野、理解度、
  つまずいた箇所、次回目標
- **入れない:** 実名、学籍番号、メールアドレス、成績、家庭事情、
  健康・心理状態に関する記述
- ポートフォリオ用のスクリーンショットは**必ずデモアカウントで撮る**
- README に「実運用データは alias のみ、公開デモは全て架空」と明記する

---

## 3. 技術構成

### 3.1 採用（v2.0 から変更なし）

| 領域 | 採用 | バージョン |
|---|---|---|
| フレームワーク | Next.js App Router | 15.x（`src/` は使わない） |
| 言語 | TypeScript | 5.x（`strict: true`, `noUncheckedIndexedAccess: true`） |
| UI | Tailwind CSS | **4.x（CSS-first）** |
| DB | PostgreSQL（Supabase） | 16 |
| Auth | Supabase Auth（メール+パスワード） | — |
| 検証 | Zod | **4.x**（`z.uuid()` / `z.iso.date()` のトップレベル形式 API） |
| AI | `@anthropic-ai/sdk` | 最新 |
| Unit/Integration | Vitest | 3.x |
| E2E | Playwright | 1.6x |
| CI | GitHub Actions | — |
| Deploy | Vercel | — |
| Node | — | 22 LTS（`.nvmrc`） |

### 3.2 採用しないもの

ORM（Prisma/Drizzle）、状態管理ライブラリ、tRPC、認証SaaS、KaTeX、Redis。
理由は v1.0 §1.2 と同じ。テーブル5個・利用者1人の規模に対して過剰。

### 3.3 Tailwind 4 の設定

`tailwind.config.js` は作らない。`app/globals.css` に以下を書く。

```css
@import "tailwindcss";

@theme {
  --color-unverified: #b45309;
  --color-verified:   #15803d;
  --color-discarded:  #64748b;
}
```

PostCSS プラグインは `@tailwindcss/postcss`。

---

## 4. データベース設計

### 4.1 マイグレーション `0001_init.sql`

```sql
create type difficulty_level as enum ('introductory', 'standard', 'advanced');
create type material_state   as enum ('unverified', 'verified', 'discarded');

-- アカウント（オーナー1つ + デモ1つ）
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 50),
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now()
);

-- 担当学生（実運用は alias、デモは架空名）
create table students (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references profiles(id) on delete cascade,
  alias         text not null check (char_length(alias) between 1 and 50),
  current_level text check (char_length(current_level) <= 100),
  learning_goal text check (char_length(learning_goal) <= 500),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index students_owner_idx on students (owner_id) where active;

-- 授業記録
create table sessions (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete cascade,
  session_date     date not null,
  topic            text not null check (char_length(topic) between 1 and 100),
  understanding    smallint not null check (understanding between 1 and 5),
  summary          text not null check (char_length(summary) between 1 and 2000),
  difficulty_notes text check (char_length(difficulty_notes) <= 2000),
  next_goal        text check (char_length(next_goal) <= 500),
  private_notes    text check (char_length(private_notes) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index sessions_student_date_idx on sessions (student_id, session_date desc);

-- 教材
create table materials (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references students(id) on delete cascade,
  session_id       uuid references sessions(id) on delete set null,
  topic            text not null check (char_length(topic) between 1 and 100),
  difficulty       difficulty_level not null,
  state            material_state not null default 'unverified',
  ai_draft         jsonb not null,
  verified_content jsonb,
  discard_reason   text check (char_length(discard_reason) <= 500),
  prompt_version   text not null,
  model_label      text not null,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- 確認済みなら中身と日時が必ず存在する
  constraint materials_verified_consistency check (
    state <> 'verified'
    or (verified_content is not null and verified_at is not null)
  ),

  -- 破棄理由は破棄状態のときだけ
  constraint materials_discarded_consistency check (
    state = 'discarded' or discard_reason is null
  ),

  -- ★ 本アプリの中核制約 ★
  -- 未確認・破棄済みの教材はセッション記録に紐づけられない
  constraint materials_session_requires_verified check (
    session_id is null or state = 'verified'
  )
);
create index materials_student_state_idx on materials (student_id, state);
create index materials_state_created_idx  on materials (state, created_at desc);
create index materials_topic_idx          on materials (student_id, topic);

-- 生成の実行ログ（失敗も記録する）
create table generation_runs (
  id               uuid primary key default gen_random_uuid(),
  material_id      uuid references materials(id) on delete cascade,
  owner_id         uuid not null references profiles(id) on delete cascade,
  model_label      text not null,
  prompt_version   text not null,
  latency_ms       integer not null check (latency_ms >= 0),
  success          boolean not null,
  validation_error text check (char_length(validation_error) <= 1000),
  created_at       timestamptz not null default now()
);
create index generation_runs_owner_created_idx on generation_runs (owner_id, created_at desc);
```

**`materials_session_requires_verified` が最重要。** アプリ側のバリデーションでは
なく DB 制約にすることで、どの経路から書き込んでも未確認教材が授業記録に
入らない。§11.2 でこの制約が実際に効くことを検証する。

### 4.2 マイグレーション `0002_rls.sql`

```sql
alter table profiles        enable row level security;
alter table students        enable row level security;
alter table sessions        enable row level security;
alter table materials       enable row level security;
alter table generation_runs enable row level security;

-- 自分のプロフィールのみ
create policy profiles_self_select on profiles
  for select using (id = auth.uid());

-- 学生は所有者のみ
create policy students_owner_all on students
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- セッションは所有する学生のものだけ
create policy sessions_owner_all on sessions
  for all using (
    exists (select 1 from students s
            where s.id = sessions.student_id and s.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from students s
            where s.id = sessions.student_id and s.owner_id = auth.uid())
  );

-- 教材も同様
create policy materials_owner_all on materials
  for all using (
    exists (select 1 from students s
            where s.id = materials.student_id and s.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from students s
            where s.id = materials.student_id and s.owner_id = auth.uid())
  );

-- 生成ログは本人のみ
create policy runs_owner_all on generation_runs
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
```

**設計上の要点:** 匿名ロールに対するポリシーを1つも書かない。RLS は
デフォルト拒否なので、未ログインでは全テーブルが0行に見える。デモアカウントは
別の `auth.uid()` を持つため、オーナーの行には構造的に到達できない。

### 4.3 シード `0003_seed.sql`

```sql
-- All demo data below is fictional. Created for portfolio demonstration only.
-- No real student information is used.
```

デモアカウント配下に以下を作る。

- 架空学生3名: `Demo Student A (Algebra)` / `Demo Student B (Calculus)` /
  `Demo Student C (Statistics)`
- セッション: A に4件（理解度 2→3→3→4 の推移）、B に2件、**C に0件**（空状態確認用）
- 教材: `verified` 2件（うち1件は A のセッションに紐づけ済み）、
  `unverified` 2件、`discarded` 1件
- `generation_runs`: 成功4件、失敗1件（`validation_error` 入り）

オーナーアカウントには何も入れない。本人が実務で入力する。

### 4.4 デモデータのリセット

`supabase/reset-demo.sql` は**デモアカウント配下のみ**を削除して再投入する。
オーナーのデータを消さないよう、`where owner_id = (select id from profiles where is_demo)`
で絞る。全件 `truncate` は使わない。

画面からも実行できるよう `resetDemoData` Server Action を用意し、
デモアカウントでログイン中のみ表示する。

---

## 5. 認証

### 5.1 ログイン方式

- オーナー: メール + パスワードの通常フォーム
- デモ: 「デモを試す」ボタン。Server Action で環境変数の資格情報を使いサインイン

v2.0 §5.1 と同じく、Cookie にロールを持たせる方式は採らない。RLS が
`auth.uid()` に依存するため、Supabase Auth のセッションが必要。

### 5.2 ガード

```ts
// lib/auth/guards.ts
export async function requireProfile() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  return profile;
}
```

`app/(app)/layout.tsx` で `await requireProfile()` を呼ぶ。ロール分岐は不要。

ガードは UX のため、RLS はセキュリティのため。ガードを外してもデータは漏れない
状態を Integration テストで確認する。

---

## 6. 環境変数

```dotenv
# --- Supabase ---
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# --- AI ---
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5
AI_EFFORT=medium
PROMPT_VERSION=v1

# --- レート制限 ---
GENERATION_RATE_LIMIT_OWNER=20
GENERATION_RATE_LIMIT_DEMO=3

# --- デモアカウント ---
DEMO_EMAIL=demo@tutorflow.local
DEMO_PASSWORD=

# --- 開発用 ---
MOCK_AI=0
```

`NEXT_PUBLIC_` が付く変数だけがブラウザに届く。`ANTHROPIC_API_KEY` と
`SUPABASE_SERVICE_ROLE_KEY` には絶対に付けない。
`lib/ai/` と `lib/db/server.ts` の先頭に `import "server-only";` を書く。

---

## 7. リポジトリ構成

```text
tutorflow-ai/
├─ app/
│  ├─ layout.tsx
│  ├─ page.tsx                        # Landing
│  ├─ globals.css
│  ├─ about/page.tsx
│  ├─ login/page.tsx + actions.ts
│  ├─ (app)/
│  │  ├─ layout.tsx                   # requireProfile + ナビ
│  │  ├─ home/page.tsx
│  │  ├─ students/page.tsx + actions.ts
│  │  ├─ students/[id]/page.tsx
│  │  ├─ sessions/new/page.tsx
│  │  ├─ sessions/[id]/edit/page.tsx
│  │  ├─ sessions/actions.ts
│  │  ├─ materials/new/page.tsx
│  │  ├─ materials/[id]/page.tsx      # レビュー画面（中心）
│  │  ├─ materials/actions.ts
│  │  └─ library/page.tsx
│  ├─ run/[materialId]/page.tsx       # セッションモード（専用レイアウト）
│  └─ api/
│     ├─ materials/generate/route.ts
│     └─ health/route.ts
├─ components/
│  ├─ ui/                             # Button, Input, Textarea, Select, Badge, Card
│  ├─ StateBadge.tsx                  # 未確認/確認済み/破棄を文字+色
│  ├─ MaterialDiff.tsx                # 左:AI原案 右:修正版
│  ├─ ProblemEditor.tsx
│  ├─ VerifyChecklist.tsx             # 7項目
│  ├─ HintDisclosure.tsx              # 段階ヒント（セッションモードで使用）
│  ├─ EmptyState.tsx / ErrorState.tsx / LoadingState.tsx
│  └─ AiDraftWarning.tsx
├─ lib/
│  ├─ ai/       client.ts, prompt.ts, generate.ts, mock.ts, rate-limit.ts
│  ├─ auth/     session.ts, guards.ts
│  ├─ db/       client.ts, server.ts, action.ts, types.ts, queries/
│  ├─ validation/ student.ts, session.ts, material.ts, ai-output.ts
│  └─ utils/format.ts
├─ supabase/
│  ├─ migrations/0001_init.sql, 0002_rls.sql, 0003_seed.sql
│  └─ reset-demo.sql
├─ tests/
│  ├─ unit/        ai-output.test.ts, session-validation.test.ts, material-state.test.ts
│  ├─ integration/ ownership.test.ts, verification-gate.test.ts
│  └─ e2e/         prepare-and-run.spec.ts
├─ docs/           architecture.md, data-model.md, ai-evaluation.md, screenshots/
├─ .github/workflows/ci.yml
├─ AGENTS.md / AI_USAGE.md / DEVLOG.md / README.md / .env.example / .nvmrc
```

### 7.1 Supabase クライアントの3分割

Next.js 15 では `cookies()` が非同期。以下を別ファイルにする。

- `lib/db/client.ts` — ブラウザ用。`createBrowserClient`
- `lib/db/server.ts` — Server Component 用。`createServerClient` + `await cookies()`。
  **Cookie 書き込みは try/catch で握りつぶす**（RSC からは書けない）
- `lib/db/action.ts` — Server Action / Route Handler 用。Cookie 書き込み可

`SUPABASE_SERVICE_ROLE_KEY` を使うのは seed とテストユーティリティのみ。
リクエスト経路では絶対に使わない。

---

## 8. バリデーション層

### 8.1 AI 出力スキーマ `lib/validation/ai-output.ts`

```ts
import { z } from "zod";

export const DIFFICULTIES = ["introductory", "standard", "advanced"] as const;

export const problemSchema = z.object({
  question: z.string().min(5).max(1000),
  hints: z.array(z.string().min(1).max(500)).min(1).max(4),
  solution_steps: z.array(z.string().min(1).max(500)).min(1).max(10),
  common_mistakes: z.array(z.string().min(1).max(300)).max(5),
});

export const materialDraftSchema = z.object({
  topic: z.string().min(1).max(100),
  difficulty: z.enum(DIFFICULTIES),
  learning_objective: z.string().min(5).max(300),
  problems: z.array(problemSchema).min(1).max(5),
  review_warning: z.string().min(1),
});

export type MaterialDraft = z.infer<typeof materialDraftSchema>;
export type Problem = z.infer<typeof problemSchema>;
```

### 8.2 生成条件 `lib/validation/material.ts`

```ts
export const generateRequestSchema = z.object({
  studentId: z.uuid(),
  topic: z.string().trim().min(1).max(100),
  difficulty: z.enum(DIFFICULTIES),
  problemCount: z.number().int().min(1).max(5),
  learningObjective: z.string().trim().min(5).max(300),
});
```

`sessionId` は生成時には受け取らない。教材は「これから使うもの」として作られ、
セッション記録は事後に書くため、紐づけは記録作成時に行う（§9.6）。

### 8.3 要求との一致確認（二段構え）

```ts
export function assertMatchesRequest(draft: MaterialDraft, req: GenerateRequest) {
  if (draft.problems.length !== req.problemCount) {
    throw new ValidationError(
      `problem count mismatch: requested ${req.problemCount}, got ${draft.problems.length}`);
  }
  if (draft.difficulty !== req.difficulty) {
    throw new ValidationError(
      `difficulty mismatch: requested ${req.difficulty}, got ${draft.difficulty}`);
  }
}
```

スキーマ適合と要求充足は別問題。この関数の存在自体が説明材料になる。

### 8.4 セッション入力 `lib/validation/session.ts`

```ts
export const sessionInputSchema = z.object({
  studentId: z.uuid(),
  sessionDate: z.iso.date(),
  topic: z.string().trim().min(1).max(100),
  understanding: z.number().int().min(1).max(5),
  summary: z.string().trim().min(1).max(2000),
  difficultyNotes: z.string().trim().max(2000).optional(),
  nextGoal: z.string().trim().max(500).optional(),
  privateNotes: z.string().trim().max(2000).optional(),
  usedMaterialIds: z.array(z.uuid()).max(5).default([]),  // 確認済みのみ許可
});
```

---

## 9. AI 連携

### 9.1 モデルと料金

| モデル | ID | 入力 $/1M | 出力 $/1M | 用途 |
|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5.00 | $25.00 | **既定**。数学的正確さが核心 |
| Claude Sonnet 5 | `claude-sonnet-5` | $3.00（8/31まで $2.00） | $15.00（同 $10.00） | コスト抑制時 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | 評価の下見用 |

1回の生成でプロンプト約1,200トークン、出力約1,500トークン。Opus 5 で約 $0.044。
実運用（週10回程度）+ 開発中200回でも月 $15 以内に収まる。

### 9.2 生成の実装 `lib/ai/generate.ts`

```ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client";
import { materialDraftSchema, type MaterialDraft } from "@/lib/validation/ai-output";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { mockDraft } from "./mock";

export class AiUnavailableError extends Error {}
export class AiInvalidOutputError extends Error {}

export async function generateMaterialDraft(req: GenerateRequest) {
  if (process.env.MOCK_AI === "1" && process.env.NODE_ENV !== "production") {
    return mockDraft(req);
  }

  const model = process.env.AI_MODEL ?? "claude-opus-5";
  const started = Date.now();

  let response;
  try {
    response = await anthropic.messages.parse({
      model,
      max_tokens: 16000,          // thinking と応答本文の合計上限
      output_config: {
        effort: (process.env.AI_EFFORT ?? "medium") as "low" | "medium" | "high",
        format: zodOutputFormat(materialDraftSchema),
      },
      system: SYSTEM_PROMPT,       // 固定文字列 → プロンプトキャッシュが効く
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError)     throw new AiUnavailableError("rate_limited");
    if (e instanceof Anthropic.APIConnectionError) throw new AiUnavailableError("network");
    if (e instanceof Anthropic.APIError)           throw new AiUnavailableError(`api_${e.status}`);
    throw e;
  }

  const latencyMs = Date.now() - started;

  if (response.stop_reason === "refusal")    throw new AiInvalidOutputError("refused");
  if (response.stop_reason === "max_tokens") throw new AiInvalidOutputError("truncated");
  if (!response.parsed_output)               throw new AiInvalidOutputError("schema_parse_failed");

  const draft = response.parsed_output;
  assertMatchesRequest(draft, req);
  return { draft, latencyMs, modelLabel: model };
}
```

**実装上の注意（すべて必須）:**

1. `max_tokens` は **thinking と応答本文の合計**上限。Opus 5 は thinking が既定で
   有効なので、応答サイズだけで見積もると途中で切れる
2. `temperature` / `top_p` は Opus 5 では**受け付けられない**（400 になる）。
   出力の揺らぎはプロンプトで制御する
3. `content` を読む前に `stop_reason === "refusal"` を判定する。拒否時も HTTP 200 が返る
4. `parsed_output` は null になりうるので必ずチェックする
5. `system` を固定文字列にしてプロンプトキャッシュを効かせる（Opus 5 の最小は512トークン）

### 9.3 プロンプト `lib/ai/prompt.ts`

```ts
export const PROMPT_VERSION = "v1";

export const SYSTEM_PROMPT = `You are assisting a human mathematics tutor by drafting practice materials.

Your output is a DRAFT. The tutor verifies every problem before using it in a
session. Never address a student directly.

Rules:
- Write problems solvable with the stated topic and difficulty alone.
- Hints must be progressive: the first points at the approach, the last gets close
  to the method but never states the final answer.
- solution_steps must show intermediate work, not just the final answer.
- common_mistakes must describe errors a real learner makes.
- Use plain-text math notation (x^2, sqrt(2), (a+b)/c). Do not use LaTeX.
- Never include names, identifiers, or any information about real people.
- Always set review_warning to: "AI-generated draft. Verify all mathematics before use."

Difficulty definitions:
- introductory: single concept, small integers, one step
- standard: two or three steps, may combine two concepts
- advanced: multi-step, requires choosing among methods`;

export function buildUserPrompt(req: GenerateRequest): string {
  return [
    `Topic: ${req.topic}`,
    `Difficulty: ${req.difficulty}`,
    `Number of problems: ${req.problemCount}`,
    `Learning objective: ${req.learningObjective}`,
    ``,
    `Produce exactly ${req.problemCount} problem(s) matching the difficulty above.`,
  ].join("\n");
}
```

**個人情報を渡せない設計:** `buildUserPrompt` は分野・難易度・問題数・学習目標の
4つしか受け取れない。`students.alias` も `sessions.private_notes` も型として
渡せない。「気をつける」ではなく関数シグネチャで防ぐ。

### 9.4 モック `lib/ai/mock.ts`

`MOCK_AI=1` かつ `NODE_ENV !== "production"` のときに使う固定 fixture。

- 正常データ1件（`materialDraftSchema` を通る）
- 異常データ3件（問題数不一致 / 難易度不一致 / ヒント空配列）

異常データは Unit テストと E2E の失敗経路で使う。

### 9.5 レート制限 `lib/ai/rate-limit.ts`

```ts
export async function checkGenerationLimit(profile: Profile) {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("generation_runs")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", profile.id)
    .gte("created_at", since);

  const limit = profile.is_demo
    ? Number(process.env.GENERATION_RATE_LIMIT_DEMO ?? 3)
    : Number(process.env.GENERATION_RATE_LIMIT_OWNER ?? 20);

  if ((count ?? 0) >= limit) throw new RateLimitError(`1時間あたり${limit}回までです。`);
}
```

Redis を使わず DB カウントにする。利用者が実質1人の規模で外部依存を増やす
価値がないため。

---

## 10. API 契約

### 10.1 Route Handler

| Method | Path | Request | 200 | Errors |
|---|---|---|---|---|
| POST | `/api/materials/generate` | `generateRequestSchema` | `{ materialId, draft }` | 400 / 401 / 403 / 429 / 502 / 422 |
| GET | `/api/health` | — | `{ ok: true }` | — |

```ts
type ApiError = {
  error: {
    code: "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN"
        | "RATE_LIMITED" | "AI_UNAVAILABLE" | "AI_INVALID_OUTPUT";
    message: string;     // 画面にそのまま出せる日本語
    retryable: boolean;
  };
};
```

**ログに個人情報を残さない。** `console.error` に出してよいのは
`{ code, materialId, ownerId, latencyMs }` のみ。プロンプト本文と AI 応答本文は
出さない。

### 10.2 生成フロー

```
POST /api/materials/generate
  1. 認証確認 → 401
  2. Zod 検証 → 400
  3. 対象学生の所有者か確認 → 403
  4. レート制限 → 429
  5. generateMaterialDraft()
       失敗 → generation_runs に success=false を記録 → 502 / 422
  6. materials へ state='unverified' で insert
  7. generation_runs に success=true を記録
  8. 200
```

失敗も必ず記録する。`docs/ai-evaluation.md` に実際の失敗率を書くため。

### 10.3 Server Actions

| Action | 認可 | 検証 |
|---|---|---|
| `createStudent` / `updateStudent` / `deactivateStudent` | 所有者 | alias 必須 |
| `createSession` / `updateSession` / `deleteSession` | 所有者 | `sessionInputSchema` |
| `verifyMaterial` | 所有者 | 修正後内容が `materialDraftSchema` を通ること。`unverified` からのみ |
| `discardMaterial` | 所有者 | `unverified` からのみ。理由は任意 |
| `saveMaterialEdit` | 所有者 | `verified_content` に保存、state は `unverified` のまま |
| `attachMaterialsToSession` | 所有者 | **`verified` の教材のみ**。DB 制約が最終防衛線 |
| `duplicateMaterial` | 所有者 | 確認済み教材を複製し `unverified` で作成 |
| `resetDemoData` | デモアカウントのみ | — |

状態遷移は `unverified → verified` と `unverified → discarded` のみ。
各 Action の冒頭で `if (material.state !== "unverified") throw` を書く。

---

## 11. 画面仕様

### 11.1 Landing `/`

ポートフォリオ来訪者向け。作品名、一文説明、「これは DVC の公式製品ではない」
「デモのデータは全て架空」の明記、デモを試すボタン、GitHub リンク、About リンク。

### 11.2 Login `/login`

オーナー用のメール+パスワードフォームと、「デモを試す」ボタン。
デモボタンの下に「架空データで全機能を試せます」と1行。

### 11.3 Home `/home`

- 担当学生の一覧（最終セッション日つき）
- 直近のセッション5件
- **未確認のまま溜まっている教材の件数（強調）** → 1クリックでレビューへ
- デモアカウントの場合のみ「デモデータをリセット」

**受け入れ基準:** 未確認教材が0件のときは空状態メッセージを出す。

### 11.4 Students `/students`, `/students/[id]`

- 一覧: alias / current_level / learning_goal / 最終セッション日
- 詳細: 学習目標、セッション履歴（新しい順）、この学生の教材（state 別）、
  **理解度の推移（直近5件を数値と簡易バーで）**

**受け入れ基準:** 学生0件のとき「最初の学生を追加する」導線が出る。

### 11.5 Session Editor `/sessions/new`, `/sessions/[id]/edit`

- 理解度は 1〜5 のセグメント選択（数値入力にしない）
- `private_notes` の欄に「自分専用メモ」と明記
- **使った教材の選択欄には確認済みの教材しか出さない**

**受け入れ基準:** 必須項目未入力時、どの項目が問題かフィールド単位で表示される。

### 11.6 Material Generator `/materials/new`

入力: 学生、分野、難易度、問題数、学習目標。
学生を選ぶと、その学生の直近セッションの `next_goal` が学習目標欄に自動で入る
（編集可）。ここがループを閉じる仕掛け。

生成中はボタンを無効化し「生成には30秒ほどかかります」を表示。
失敗時はエラー種別ごとの日本語メッセージと再試行ボタン。入力内容は保持する。

### 11.7 Material Review `/materials/[id]` — **作品の中心**

```
┌──────────────────────────────────────────────────────────┐
│ [未確認] Quadratic equations / standard    Student A     │
│ ⚠ AI生成の下書きです。使用前にすべて検算してください。      │
├────────────────────────────┬─────────────────────────────┤
│  AI 原案（読み取り専用）     │  修正版（編集可）            │
│  Problem 1                 │  Problem 1                  │
│  x^2 - 5x + 6 = 0 を解け    │  [編集可能テキストエリア]     │
│  Hints (2)                 │  Hints (2)  [+追加]         │
│  Solution steps (2)        │  Solution steps (2)         │
│  Common mistakes (1)       │  Common mistakes (1)        │
├────────────────────────────┴─────────────────────────────┤
│ 検算チェックリスト                                         │
│ □ 問題は解けるか   □ 解答は正しいか   □ 難易度は合うか      │
│ □ ヒントが答えを明かしていないか  □ 説明に飛躍がないか      │
│ □ 不適切な表現がないか  □ 個人情報が混入していないか        │
├──────────────────────────────────────────────────────────┤
│      [ 破棄 ]    [ 下書き保存 ]    [ 確認済みにする ]      │
└──────────────────────────────────────────────────────────┘
```

- 左右で差分がある箇所に変更済みバッジを付ける
- **7項目すべてにチェックが入るまで「確認済みにする」は無効**
- 状態は色だけでなく文字でも表示
- モバイルでは左右を上下タブに切り替える

**受け入れ基準:** 確認済みの教材を開くと編集不可の閲覧モードになる。

### 11.8 Library `/library`

確認済み教材の一覧。分野でフィルタ、学生でフィルタ、新しい順。
各行から「セッションモードで開く」「複製して再利用」。
既定フィルタは `確認済み` のみ。未確認・破棄は明示的に切り替えて表示する。

**受け入れ基準:** 同じ学生に過去出した分野が一目で分かる（重複出題の防止）。

### 11.9 Session Mode `/run/[materialId]` — 授業中に開く画面

**専用レイアウト。** ナビゲーションを出さず、本文を大きく表示する。

- 問題を1問ずつ表示。次の問題へ進むボタン
- **ヒントは1つずつ開く**（`HintDisclosure`）。一度に全部出さない
- 解答手順は明示的な操作を経て表示
- よくある誤りは解答表示後にのみ出る
- 画面下に現在の問題番号（`2 / 3`）

**なぜ別ルートにするか:** 授業中に学生の隣で開く画面であり、管理用 UI とは
求められるものが違う（大きい文字、余計な導線なし、誤操作しにくい）。
レビュー画面の表示切替で兼ねると、どちらも中途半端になる。

**受け入れ基準:** 確認済み以外の教材の URL を直接開くと 404 になる。

### 11.10 About `/about`

技術構成図、AI をどこで使い人間が何を判断しているか、既知の制約。

---

## 12. UI 共通仕様

### 12.1 状態表現

すべてのデータ表示領域は4状態を持つ。`LoadingState` / `EmptyState` /
`ErrorState` の3コンポーネントで統一する。

### 12.2 教材の状態表示

| state | 表示 | 色 |
|---|---|---|
| `unverified` | `未確認` | amber |
| `verified` | `確認済み` | green |
| `discarded` | `破棄` | slate |

**色だけに依存しない。必ず文字を併記する。**

### 12.3 アクセシビリティ（P0 の最低限）

すべての入力に `<label>`、Tab で主要操作に到達可能、フォーカスリングを消さない、
`<html lang="ja">`、本文16px以上。セッションモードは本文20px以上。

### 12.4 デザイン方針

B2B SaaS 的な落ち着いたトーン。装飾的イラストは使わない。DVC のロゴ・校章・
公式サービスを想起させる表現を使わない。色数は基調1 + アクセント1 + 状態3。

---

## 13. テスト計画

### 13.1 Unit（Vitest）

**`tests/unit/ai-output.test.ts`（9ケース）**

| ケース | 期待 |
|---|---|
| `accepts a valid draft` | 成功 |
| `rejects missing problems field` | 失敗 |
| `rejects unknown difficulty value` | 失敗 |
| `rejects empty hints array` | 失敗 |
| `rejects empty solution_steps array` | 失敗 |
| `rejects a hint that is an empty string` | 失敗 |
| `rejects more than 5 problems` | 失敗 |
| `assertMatchesRequest rejects problem count mismatch` | throw |
| `assertMatchesRequest rejects difficulty mismatch` | throw |

**`tests/unit/session-validation.test.ts`（7ケース）**

| ケース | 期待 |
|---|---|
| `rejects understanding = 0` / `= 6` / `= 3.5` | 失敗 |
| `accepts understanding 1 through 5` | 5件成功 |
| `rejects empty summary` | 失敗 |
| `rejects summary over 2000 chars` | 失敗 |
| `trims whitespace-only topic and rejects` | 失敗 |

**`tests/unit/material-state.test.ts`（5ケース）**

| ケース | 期待 |
|---|---|
| `canAttachToSession returns false for unverified` | false |
| `canAttachToSession returns false for discarded` | false |
| `canAttachToSession returns true for verified` | true |
| `nextState rejects verified → unverified` | throw |
| `nextState rejects verified → discarded` | throw |

### 13.2 Integration（テスト用 Supabase）

`describe.skipIf(!process.env.SUPABASE_TEST_URL)` でガードする。

**`tests/integration/ownership.test.ts`**

| ケース | 期待 |
|---|---|
| `owner can create student and session` | 成功 |
| `demo account cannot read owner students` | 0行 |
| `demo account cannot read owner sessions` | 0行 |
| `demo account cannot read owner materials` | 0行 |
| `demo account cannot update owner student` | 0行更新 |
| `anonymous client reads nothing from any table` | 全表0行 |

**`tests/integration/verification-gate.test.ts`**

| ケース | 期待 |
|---|---|
| `db rejects linking an unverified material to a session` | **制約違反エラー** |
| `db rejects linking a discarded material to a session` | 制約違反エラー |
| `db accepts linking a verified material` | 成功 |
| `db rejects verified state without verified_content` | 制約違反エラー |
| `verifying sets verified_at` | 非 null |
| `verifying twice is rejected` | 2回目でエラー |
| `failed generation is recorded with success=false` | 1行増える |
| `demo rate limit blocks the 4th generation in an hour` | エラー |

**1行目が最重要。** アプリを経由せず SQL を直接叩いても未確認教材が
セッションに紐づかないことを証明する。

### 13.3 E2E（Playwright）

**`tests/e2e/prepare-and-run.spec.ts`** — 1本。`MOCK_AI=1` で実行。

```
1. / を開く →「デモを試す」
2. Home で学生 A を選ぶ
3. 教材を生成（モック）→ 未確認として表示される
4. レビュー画面で問題文を編集
5. チェックリストが未完のうちは「確認済みにする」が無効であることを確認
6. 7項目すべてチェック → 確認済みにする
7. ライブラリに確認済みとして出ることを確認
8. セッションモードを開き、ヒントが1つずつ開くことを確認
9. セッション記録を作成し、この教材を紐づける
10. 未確認の教材はセッション記録の選択欄に出ないことを確認
```

### 13.4 Manual チェックリスト

- [ ] iPhone サイズ（375px）で主要操作が可能
- [ ] キーボードのみで「ログイン→確認済みにする」まで到達できる
- [ ] セッションモードを実際の授業想定の距離で見て文字が読める
- [ ] 長い数式（100文字以上）が折り返して読める
- [ ] AI キーを無効値にして失敗表示を確認
- [ ] 学生0件・セッション0件・教材0件の空状態を確認

---

## 14. CI とデプロイ

### 14.1 `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm run test:unit
      - run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: https://placeholder.supabase.co
          NEXT_PUBLIC_SUPABASE_ANON_KEY: placeholder
```

Integration と E2E は CI に含めない。Supabase のテストプロジェクトが必要で
初回構築コストが高いため。**この判断と理由を README の Testing 節に正直に書く。**

```json
{
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:e2e": "playwright test"
}
```

### 14.2 ビルド時の注意

`(app)` と `run` 配下のページに `export const dynamic = "force-dynamic";` を書く。
これがないとビルド時のプリレンダリングが Supabase へ接続しようとして失敗する。

---

## 15. 作業分解（10日・44チケット）

### Phase 0（コードを書かない）

| ID | 作業 | 完了条件 |
|---|---|---|
| P0-1 | Anthropic API キー発行 + 使用量アラート（月20USD） | 設定済み |
| P0-2 | Supabase プロジェクト作成（dev / test / prod） | 接続情報が手元にある |
| P0-3 | GitHub リポジトリ作成 | URL が存在する |

### Day 1: 土台と CI

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D1-1 | `create-next-app`（TS / Tailwind 4 / App Router） | `npm run dev` 起動 | `chore: initialize Next.js and CI` |
| D1-2 | `tsconfig` strict 化、`.nvmrc` | `npm run typecheck` 通過 | 同上 |
| D1-3 | `.gitignore` に `.env*`、`.env.example` 作成 | `git status` に .env が出ない | 同上 |
| D1-4 | `ci.yml` | Actions が緑 | 同上 |
| D1-5 | README に背景・目的・免責 | 免責3行が入る | `docs: define product scope` |
| D1-6 | `DEVLOG.md` / `AI_USAGE.md` / `AGENTS.md` 雛形 | ファイルが存在 | 同上 |

### Day 2: DB と認証

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D2-1 | `0001_init.sql`（**3つの CHECK 制約を含む**） | 5表作成 | `feat: add schema with verification gate` |
| D2-2 | `0002_rls.sql` | 全表 RLS 有効 | 同上 |
| D2-3 | `lib/db/types.ts`（DDL から手書き） | 型が import できる | 同上 |
| D2-4 | Supabase クライアント3分割 | サーバーから select 可 | `feat: add auth and ownership scoping` |
| D2-5 | `0003_seed.sql`（デモアカウント配下のみ） | 学生3・セッション6・教材5 | 同上 |
| D2-6 | `reset-demo.sql` + `resetDemoData` Action | デモのみ初期化される | 同上 |
| D2-7 | ログイン画面 + デモログイン Action | 両方でログインできる | 同上 |
| D2-8 | `requireProfile` と `(app)/layout.tsx` | 未ログインで `/login` へ | 同上 |

### Day 3: 学生・セッション CRUD

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D3-1 | `validation/student.ts` `session.ts` | Zod 完成 | `feat: add student and session management` |
| D3-2 | UI プリミティブ6種 | 実画面で確認 | 同上 |
| D3-3 | `EmptyState` / `ErrorState` / `LoadingState` | 3種完成 | 同上 |
| D3-4 | 学生一覧 + 追加 | 追加が反映 | 同上 |
| D3-5 | 学生詳細（目標・履歴・教材・理解度推移） | 4区画表示 | 同上 |
| D3-6 | セッション作成・編集・削除 | 全操作可 | 同上 |
| D3-7 | フィールド単位エラー表示 | 空 summary で該当欄に赤字 | 同上 |
| D3-8 | Home 画面 | 3ブロック表示 | 同上 |

**完了条件:** AI なしでも学習記録アプリとして使える。

### Day 4: AI 生成

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D4-1 | `validation/ai-output.ts` | 型完成 | `feat: generate structured material drafts` |
| D4-2 | `tests/unit/ai-output.test.ts` を先に書く | 9ケース通過 | `test: cover AI output validation` |
| D4-3 | `lib/ai/prompt.ts` | 定数完成 | `feat: generate structured material drafts` |
| D4-4 | `lib/ai/generate.ts`（§9.2 の5注意点を守る） | モックで1件生成 | 同上 |
| D4-5 | `lib/ai/mock.ts`（正常1 + 異常3） | fixture 完成 | 同上 |
| D4-6 | `assertMatchesRequest` | 不一致で throw | 同上 |
| D4-7 | `lib/ai/rate-limit.ts`（オーナー/デモで別上限） | 上限で throw | 同上 |
| D4-8 | `POST /api/materials/generate` | 未確認教材が DB に入る | 同上 |
| D4-9 | `generation_runs` 記録（成功・失敗とも） | 失敗時も1行増える | 同上 |
| D4-10 | Generator 画面（next_goal 自動入力を含む） | 3状態確認可 | 同上 |

### Day 5: レビューと確認ゲート — **MVP・実運用開始可能**

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D5-1 | `MaterialDiff`（左右2カラム） | 原案と修正版が並ぶ | `feat: add verification workflow` |
| D5-2 | `ProblemEditor` | 編集が state に反映 | 同上 |
| D5-3 | `VerifyChecklist`（7項目） | 全チェックまでボタン無効 | 同上 |
| D5-4 | `verifyMaterial` Action（状態遷移制約付き） | `verified_at` が入る | 同上 |
| D5-5 | `discardMaterial` Action | `discard_reason` が入る | 同上 |
| D5-6 | `saveMaterialEdit` Action | state は unverified のまま | 同上 |
| D5-7 | `StateBadge`（文字+色） | 3状態を文字で判別可 | 同上 |
| D5-8 | `attachMaterialsToSession` + 選択欄を確認済みに限定 | 未確認が選択欄に出ない | 同上 |
| D5-9 | `tests/unit/material-state.test.ts` | 5ケース通過 | `test: cover material state transitions` |

**この日の終わりから実務で使い始める。** 以降の DEVLOG は実使用の記録になる。

### Day 6: セッションモードとライブラリ

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D6-1 | `HintDisclosure`（1つずつ開く） | 段階表示が動く | `feat: add session mode and material library` |
| D6-2 | `/run/[materialId]` 専用レイアウト | ナビなし・大きい文字 | 同上 |
| D6-3 | 解答手順・よくある誤りの表示制御 | 押すまで出ない | 同上 |
| D6-4 | 未確認教材の `/run` は 404 | 直接 URL で 404 | 同上 |
| D6-5 | `/library`（フィルタ・複製） | 分野別に絞れる | 同上 |
| D6-6 | `duplicateMaterial` Action | 複製が unverified で作られる | 同上 |
| D6-7 | Landing / About | 免責と構成説明 | `docs: add architecture notes` |

### Day 7: 品質

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D7-1 | `tests/integration/ownership.test.ts` | 6ケース（実 DB で実行） | `test: cover ownership isolation` |
| D7-2 | `tests/integration/verification-gate.test.ts` | 8ケース（実 DB で実行） | `test: cover verification gate` |
| D7-3 | E2E 1本 | Playwright 緑 | 同上 |
| D7-4 | API キー露出チェック（`rg "sk-ant" .next`） | 0件 + スクリーンショット | `fix: handle failures and empty states` |
| D7-5 | 全画面の空・失敗状態を発生させ撮影 | スクリーンショット取得 | 同上 |
| D7-6 | エラーメッセージの日本語見直し | 技術用語が画面に出ない | 同上 |
| D7-7 | ログに個人情報が出ないことを確認 | 全ログ箇所を確認 | 同上 |

### Day 8: 公開

| ID | 作業 | 完了条件 |
|---|---|---|
| D8-1 | 本番 Supabase にマイグレーション適用 | 5表存在 |
| D8-2 | オーナー + デモアカウント作成、seed 投入 | 両方ログイン可 |
| D8-3 | Vercel デプロイ + 環境変数設定 | 公開 URL 稼働 |
| D8-4 | `supabase gen types` で型を再生成し差分確認 | 差分ゼロまたは意図した差分のみ |
| D8-5 | 公開 URL で E2E シナリオを手動実行 | 全ステップ成功 |
| D8-6 | モバイル実機確認 | チェックリスト完了 |
| D8-7 | 第三者にデモを触ってもらい導線を修正 | 修正済み |

### Day 9: ドキュメント

| ID | 作業 | 完了条件 |
|---|---|---|
| D9-1 | README（§16 の構成） | 全節が埋まる |
| D9-2 | `docs/architecture.md` + 構成図 | Mermaid 図 |
| D9-3 | `docs/data-model.md` | ER 図と制約の説明 |
| D9-4 | スクリーンショット6枚以上 | Review と Session Mode を含む |
| D9-5 | **AI 評価10ケース（実運用の記録を優先）** | `docs/ai-evaluation.md` 完成 |
| D9-6 | `AI_USAGE.md` を実内容で埋める | 具体例が入る |
| D9-7 | `DEVLOG.md` を整える | 実使用で見つけた問題が入る |
| D9-8 | 既知の問題・今後の改善 | 正直に書く |

### Day 10: 仕上げ

| ID | 作業 | 完了条件 |
|---|---|---|
| D10-1 | 残不具合の修正 | 0件 |
| D10-2 | 90秒説明を書いて計測 | 90秒以内 |
| D10-3 | 5分デモの手順と実演練習 | 5分以内 |
| D10-4 | 履歴書用の説明文 | 実装済み機能のみ |
| D10-5 | GitHub ピン留め・topics 設定 | 完了 |
| D10-6 | 公開 URL の最終確認 | 動作 |
| D10-7 | 想定質問への回答準備（§17） | メモ完成 |

---

## 16. README 構成

```text
# TutorFlow AI

## Demo               ← デモアカウントの入り方
## Background         ← DVC でのチューター経験
## Problem
## Solution
## Core Constraint    ← 未確認教材はセッションに紐づかない（DB制約）
## Key Features
## Screenshots
## Architecture
## Tech Stack
## Data Model
## Security and Privacy
## AI Evaluation      ← 実運用で AI が誤った実例
## Local Setup
## Testing            ← 実行したものと未実行のものを区別
## What I Learned
## Known Limitations
## Future Improvements
## Disclaimer
```

冒頭に以下を明記する。

```text
This is a personal tool and portfolio project, not an official DVC product.
All data in the public demo is fictional.
Real usage stores only aliases, never student names or records.
AI-generated materials require human verification and may contain errors.
```

---

## 17. 面接で説明する技術的判断

| # | 判断 | 骨子 |
|---|---|---|
| 1 | 確認ゲートを DB の CHECK 制約にした | アプリのどの経路から書いても未確認教材が授業記録に入らない。バリデーションは書き忘れるが制約は書き忘れられない |
| 2 | RLS で所有者スコープを敷いた | 公開デモの利用者が自分の実データを見られてはいけない。演出ではなく本物の要件 |
| 3 | AI 出力を JSON Schema で拘束した | 自由文のパースは失敗ケースが無限。構造を保証したうえで内容の正しさは人間が見る、と役割を分けた |
| 4 | それでも `assertMatchesRequest` を足した | スキーマ適合と要求充足は別問題。5問頼んで3問返ることがある |
| 5 | 構造検証エラーは自動再試行しない | 同条件で再送しても同じ失敗を繰り返し費用だけ増える |
| 6 | `max_tokens` を大きく取った | Opus 5 は thinking と応答の合計が上限。応答サイズだけで見積もると切れる |
| 7 | プロンプトに学生情報を渡せない関数シグネチャにした | 「気をつける」ではなく型で防ぐ |
| 8 | `prompt_version` と `model_label` を DB に持った | 評価結果がどの条件のものか後から説明できる |
| 9 | 生成の失敗も記録した | AI の性能を誇張せず実測で語るため |
| 10 | セッションモードを別ルートにした | 授業中に学生の隣で開く画面と管理 UI では要求が違う |
| 11 | レート制限を DB カウントにした | 利用者1人の規模に Redis を持ち込む価値がない |
| 12 | 学生ポータルを途中で廃止した | 実業務に存在しない利用者のために作るより、自分で使って AI の誤りを実測するほうが価値が高いと判断した |

**12番は「途中で設計を変えた理由を説明できる」証拠になるので、隠さず話す。**

---

## 18. リスクと縮退ルール

| 時点 | 判定 | 縮退内容 |
|---|---|---|
| Day 3 終了 | CRUD が動かない | UI の作り込みを止め素の HTML + Tailwind で進む |
| Day 4 終了 | 生成が動かない | 問題数を1固定、`common_mistakes` を任意にする |
| Day 5 終了 | 確認フロー未完 | Day 6 も確認フローに充てる。ライブラリを捨てる |
| Day 6 終了 | セッションモード未完 | レビュー画面の表示切替で代替（別ルートを諦める） |
| Day 7 終了 | Integration が書けない | E2E を優先。未実行を README に明記する |

**RLS、AI 出力検証、確認ゲートの DB 制約、Material Review 画面は絶対に落とさない。**

縮退したことは隠さず README の Known Limitations に理由とともに書く。

---

## 19. Definition of Done

| # | 条件 | 検証方法 |
|---|---|---|
| 1 | 公開 URL がある | シークレットウィンドウで開く |
| 2 | デモの入り方が明確 | 第三者が説明なしで触れた |
| 3 | 学生・セッション CRUD が動く | E2E ステップ 2, 9 |
| 4 | AI 教材案を生成できる | 本番で実 API 1件 |
| 5 | 未確認教材を検算して確認済みにできる | E2E ステップ 4-6 |
| 6 | **未確認教材はセッションに紐づかない** | Integration `verification-gate` 1行目 |
| 7 | デモアカウントからオーナーのデータが見えない | Integration `ownership` |
| 8 | 実名・成績などを保存していない | スキーマと運用ルールのレビュー |
| 9 | API キーが公開されていない | `rg "sk-ant" .next` が0件 |
| 10 | lint / typecheck / test:unit が通る | Actions が緑 |
| 11 | E2E が1本ある | `npx playwright test` 緑 |
| 12 | README に背景・技術・構成・起動方法 | §16 の全節 |
| 13 | `AI_USAGE.md` がある | 具体例入り |
| 14 | AI 評価結果と失敗例がある | 失敗例1件以上 |
| 15 | モバイルで主要操作ができる | 実機確認 |
| 16 | 実運用で1回以上使った | セッション記録が実データで存在する |
| 17 | 90秒で説明できる | 計測 |
| 18 | 5分でデモできる | 計測 |

**16番が v3.0 で追加された項目。** これが言えることが今回の方針転換の目的。

---

## 20. 30秒・90秒の説明

### 30秒

```text
DVC で数学チューターとして働いた経験から、授業記録と教材準備を1か所で扱う
ツールを自分用に作りました。AI が練習問題とヒントの案を作りますが、数学では
AI の誤答が致命的なので、自分が検算して確認済みにするまで授業に持ち込めない
設計にしています。
```

### 90秒

```text
2026年夏に DVC で数学チューターとして勤務した経験から、学生ごとの理解度と
次回課題を記録し、練習問題を準備する作業を一つの場所で扱えると便利だと考え、
TutorFlow AI を開発しました。

分野と難易度を指定すると AI が練習問題・段階的ヒント・解答手順の案を作ります。
ただし数学では AI の誤答が大きな問題になるため、生成物は未確認状態で保存し、
7項目のチェックリストで自分が検算して確認済みにするまで、授業記録に紐づけ
られないようにしました。これはアプリのバリデーションではなくデータベースの
CHECK 制約で表現しています。

TypeScript、Next.js、PostgreSQL を使い、AI 出力の構造検証、行レベルセキュリティ
による実データとデモデータの分離、テスト、CI、デプロイまで取り組みました。
実際に自分の担当セッションで使い、AI が誤った分野と頻度を記録に残しています。

開発では生成AIをコードの下書きにも使いましたが、要件・設計・検証・修正内容は
記録し、自分で説明できる状態にしています。
```

---

## 21. 想定質問

- なぜ学生向け機能を途中でやめたのか（→ §17 の12）
- 未確認教材が授業に持ち込まれないことをどう保証しているのか（→ §17 の1）
- AI が誤答した場合どうするのか（→ 検算チェックリストと評価結果の実例）
- AI にコードを書かせただけではないか（→ AI_USAGE.md と DEVLOG.md）
- 一番難しかったバグは何か（→ 実使用中に見つけたものを話す）
- DB 設計をどう決めたか（→ 制約を先に決め、そこから表を導いた）
- 学生の情報をどう守るか（→ alias 運用、プロンプトに渡せない関数シグネチャ）
- もう一週間あれば何を改善するか
