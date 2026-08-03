# TutorFlow AI 詳細開発計画

**版:** 2.0（詳細版）
**作成日:** 2026年8月3日
**元資料:** 「TutorFlow AI ポートフォリオ開発計画 v1.0」（2026年8月4日）
**用途:** 実装スレッドがこの文書だけで着手できる粒度の作業計画

---

## 0. この文書の位置づけと前提

v1.0 は「何を作るか」を定義した。本書は「どう作るか」を定義する。v1.0 の
製品原則・スコープ（P0/P1/P2）・Definition of Done は変更しない。

### 0.1 本書で新たに確定させたもの

| 項目 | v1.0 | 本書 |
|---|---|---|
| 技術スタック | 「Next.js 等」と候補列挙 | バージョンまで確定（§1） |
| データ設計 | フィールド一覧 | DDL・制約・索引・RLS（§4） |
| AI 連携 | 「構造化出力に対応するLLM API」 | モデルID・料金・呼び出しコード（§8） |
| API | 記載なし | エンドポイント契約表（§7） |
| 画面 | 目的の一覧 | 画面ごとの受け入れ基準（§9） |
| テスト | 観点リスト | ファイル名・ケース名（§11） |
| 10日計画 | 日ごとの箇条書き | 43チケット（ID・完了条件・コミット）（§13） |

### 0.2 未確定事項と本書での既定値

v1.0 §27 の Phase 0 質問は開発開始時に本人が回答する。回答待ちで着手が
止まらないよう、以下の既定値を置く。回答が異なれば該当箇所だけ差し替える。

| # | 質問 | 本書の既定値 | 影響範囲 |
|---|---|---|---|
| 1 | 担当した数学のレベル・分野 | 一次方程式〜微積分入門（DVC の Math 120–192 相当） | AI評価10ケース（§14）、seed データ |
| 2 | 記録・教材準備の実態 | 「紙とスプレッドシート」を仮説として扱う | README の Background 節の文言のみ |
| 3 | 時間がかかった作業 | 「学生ごとの難易度調整」を仮説として扱う | 同上 |
| 4 | 開発環境 | Node.js 22 LTS / macOS または Linux / VS Code | §1、§12 |
| 5 | AI API と費用上限 | Anthropic Claude API / 月 20 USD 上限 | §8.6 |

**重要:** #2 と #3 は「実体験」か「仮説」かで README と面接の言い回しが変わる。
実装には影響しないので、Day 9（ドキュメント）までに確定すればよい。それまでは
コード内・README 内で断定的な体験談を書かない。

---

## 1. 技術スタック（確定）

### 1.1 採用構成

| 領域 | 採用 | バージョン | 選定理由 |
|---|---|---|---|
| フレームワーク | Next.js（App Router） | 15.x | UI とサーバー処理を1プロジェクトで完結。API キーをサーバー側に閉じ込められる |
| 言語 | TypeScript | 5.x（`strict: true`） | 型でAI出力とDB行の齟齬を防ぐ |
| UI | Tailwind CSS | 4.x | 設定ファイルが最小。短期間で一貫した画面 |
| DB | PostgreSQL（Supabase） | 16 | 無料枠あり。RLS で権限を DB 層に置ける |
| Auth | Supabase Auth（メール+パスワード） | — | デモアカウント2つのみ。OAuth は不要 |
| 検証 | Zod | 4.x | 入力とAI出力の両方に同じ道具を使う |
| AI | Anthropic Claude API（`@anthropic-ai/sdk`） | 最新 | 構造化出力（JSON Schema）を公式サポート |
| Unit/Integration | Vitest | 3.x | Vite ベースで設定が軽い |
| E2E | Playwright | 1.6x | 主要フロー1本を通す |
| CI | GitHub Actions | — | push 時に lint/typecheck/test |
| Deploy | Vercel | — | Next.js の公開が最短 |

### 1.2 採用しなかったもの（面接で聞かれる想定）

| 候補 | 不採用の理由 |
|---|---|
| 状態管理ライブラリ（Redux / Zustand） | Server Components + Server Actions でクライアント状態がほぼ発生しない |
| ORM（Prisma / Drizzle） | テーブル5個。Supabase クライアント + 型生成で足りる。学習コストを AI 連携に回す |
| tRPC | Server Actions が同じ役割を果たす |
| 認証SaaS（Clerk / Auth0） | デモアカウント2つに対して過剰 |
| KaTeX / MathJax | P2。P0 では数式をプレーンテキスト（`x^2` 記法）で扱う |

### 1.3 Node / パッケージ

```
Node.js 22.x LTS
パッケージマネージャ: npm（package-lock.json をコミット）
```

`.nvmrc` に `22` を記載し、CI とローカルのバージョンを揃える。

---

## 2. 環境変数と秘密情報

### 2.1 `.env.example`（リポジトリにコミットする）

```dotenv
# --- Supabase ---
# ブラウザに露出してよい値（anon key は RLS で守られる前提）
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...

# サーバー専用。RLS を無視できるため絶対にクライアントへ渡さない
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# --- AI ---
# サーバー専用。NEXT_PUBLIC_ を付けないこと
ANTHROPIC_API_KEY=sk-ant-...
AI_MODEL=claude-opus-5
AI_EFFORT=medium
PROMPT_VERSION=v1

# --- レート制限 ---
# 1チューターあたり1時間の生成上限
GENERATION_RATE_LIMIT_PER_HOUR=10

# --- デモ ---
DEMO_TUTOR_EMAIL=tutor@demo.tutorflow.local
DEMO_TUTOR_PASSWORD=
DEMO_STUDENT_EMAIL=student@demo.tutorflow.local
DEMO_STUDENT_PASSWORD=
```

### 2.2 秘密情報の扱い（Definition of Done 項目）

- `NEXT_PUBLIC_` 接頭辞が付く変数だけがブラウザに届く。`ANTHROPIC_API_KEY` と
  `SUPABASE_SERVICE_ROLE_KEY` には**絶対に付けない**。
- `.gitignore` に `.env`, `.env.local`, `.env*.local` を入れる（Day 1 で確認）。
- Day 7 の検証手順: 本番ビルドの出力を `grep -r "sk-ant" .next/` で走査し、
  0 件であることをスクリーンショットに残す（README の Security 節に貼る）。
- Anthropic Console で使用量アラート（月 20 USD）を設定する。

### 2.3 サーバー専用モジュールの隔離

`lib/ai/` と `lib/db/server.ts` の先頭に `import "server-only";` を書く。
これによりクライアントコンポーネントから誤って import した時点でビルドが失敗する。

---

## 3. リポジトリ構成（ファイル単位）

```text
tutorflow-ai/
├─ app/
│  ├─ layout.tsx                       # ルートレイアウト、フォント、<html lang>
│  ├─ page.tsx                         # Landing
│  ├─ globals.css
│  ├─ about/page.tsx                   # About / Architecture
│  ├─ login/page.tsx                   # Demo Login
│  ├─ (tutor)/
│  │  ├─ layout.tsx                    # tutor ロール確認 + ナビ
│  │  ├─ dashboard/page.tsx
│  │  ├─ students/page.tsx             # 一覧・追加
│  │  ├─ students/[id]/page.tsx        # 詳細（履歴・教材）
│  │  ├─ sessions/new/page.tsx
│  │  ├─ sessions/[id]/edit/page.tsx
│  │  ├─ materials/new/page.tsx        # Material Generator
│  │  └─ materials/[id]/page.tsx       # Material Review（作品の中心）
│  ├─ (student)/
│  │  ├─ layout.tsx                    # student ロール確認
│  │  └─ my/page.tsx                   # Student View
│  └─ api/
│     ├─ materials/generate/route.ts   # POST 生成
│     └─ health/route.ts               # 死活確認（Vercel 動作確認用）
├─ components/
│  ├─ ui/                              # Button, Input, Select, Badge, Card, Dialog
│  ├─ StatusBadge.tsx                  # Draft / Approved / Rejected を文字+色で表示
│  ├─ MaterialDiff.tsx                 # 左:AI原案 / 右:編集後
│  ├─ ProblemEditor.tsx                # 問題1件の編集フォーム
│  ├─ HintDisclosure.tsx               # ヒント段階表示
│  ├─ EmptyState.tsx / ErrorState.tsx / LoadingState.tsx
│  └─ AiDraftWarning.tsx               # 「AI生成・未確認」の常時表示バナー
├─ lib/
│  ├─ ai/
│  │  ├─ client.ts                     # Anthropic クライアント生成（server-only）
│  │  ├─ prompt.ts                     # プロンプト本体 + PROMPT_VERSION
│  │  ├─ generate.ts                   # 生成 + 検証 + 失敗ハンドリング
│  │  └─ rate-limit.ts                 # 生成回数制限
│  ├─ auth/
│  │  ├─ session.ts                    # 現在のユーザーとロールを取得
│  │  └─ guards.ts                     # requireTutor() / requireStudent()
│  ├─ db/
│  │  ├─ client.ts                     # ブラウザ用 Supabase クライアント
│  │  ├─ server.ts                     # サーバー用（server-only）
│  │  ├─ types.ts                      # supabase gen types の出力
│  │  └─ queries/                      # students.ts, sessions.ts, materials.ts
│  ├─ validation/
│  │  ├─ session.ts                    # セッション入力スキーマ
│  │  ├─ student.ts
│  │  ├─ material.ts                   # 生成条件の入力スキーマ
│  │  └─ ai-output.ts                  # AI出力スキーマ（最重要）
│  └─ utils/format.ts
├─ supabase/
│  ├─ migrations/
│  │  ├─ 0001_init.sql                 # テーブル + 制約 + 索引
│  │  ├─ 0002_rls.sql                  # RLS ポリシー
│  │  └─ 0003_seed.sql                 # デモ用架空データ
│  └─ reset-demo.sql                   # デモデータ初期化スクリプト
├─ tests/
│  ├─ unit/
│  │  ├─ ai-output.test.ts
│  │  ├─ session-validation.test.ts
│  │  └─ material-visibility.test.ts
│  ├─ integration/
│  │  ├─ material-approval.test.ts
│  │  └─ permissions.test.ts
│  └─ e2e/
│     └─ tutor-to-student.spec.ts
├─ docs/
│  ├─ architecture.md
│  ├─ ai-evaluation.md
│  ├─ data-model.md
│  └─ screenshots/
├─ .github/workflows/ci.yml
├─ .nvmrc
├─ AI_USAGE.md
├─ DEVLOG.md
├─ README.md
└─ .env.example
```

**方針:** ディレクトリを機能で細分化しない。`lib/` 直下は ai / auth / db /
validation の4つだけに固定する。面接で「なぜこの構成か」を1文で説明できることを
優先する。

---

## 4. データベース設計

### 4.1 マイグレーション `0001_init.sql`

```sql
-- 列挙型
create type user_role       as enum ('tutor', 'student');
create type user_locale     as enum ('ja', 'en');
create type difficulty_level as enum ('introductory', 'standard', 'advanced');
create type material_status  as enum ('draft', 'approved', 'rejected');

-- プロフィール（auth.users と 1:1）
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  role         user_role   not null,
  display_name text        not null check (char_length(display_name) between 1 and 50),
  locale       user_locale not null default 'ja',
  created_at   timestamptz not null default now()
);

-- 架空学生
create table students (
  id            uuid primary key default gen_random_uuid(),
  tutor_id      uuid not null references profiles(id) on delete cascade,
  alias         text not null check (char_length(alias) between 1 and 50),
  current_level text check (char_length(current_level) <= 100),
  learning_goal text check (char_length(learning_goal) <= 500),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index students_tutor_id_idx on students (tutor_id) where active;

-- 学生を閲覧できるユーザー（P0では 1学生 : 1閲覧アカウント）
-- 学生画面がどの students 行を見るかを解決するために必要
create table student_viewers (
  student_id uuid not null references students(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  primary key (student_id, profile_id)
);

-- セッション記録
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
  status           material_status  not null default 'draft',
  ai_draft         jsonb not null,
  approved_content jsonb,
  rejection_reason text check (char_length(rejection_reason) <= 500),
  prompt_version   text not null,
  approved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- 承認済みなら中身と日時が必ず存在する（学生画面の前提を DB で保証）
  constraint materials_approved_consistency check (
    (status <> 'approved')
    or (approved_content is not null and approved_at is not null)
  ),
  -- 却下なら理由の有無は任意だが、承認済みに却下理由は残さない
  constraint materials_rejected_consistency check (
    status = 'rejected' or rejection_reason is null
  )
);
create index materials_student_status_idx on materials (student_id, status);
create index materials_status_created_idx  on materials (status, created_at desc);

-- 生成実行ログ（AI の失敗も記録する）
create table generation_runs (
  id               uuid primary key default gen_random_uuid(),
  material_id      uuid references materials(id) on delete cascade,
  tutor_id         uuid not null references profiles(id) on delete cascade,
  model_label      text not null,
  prompt_version   text not null,
  latency_ms       integer not null check (latency_ms >= 0),
  success          boolean not null,
  validation_error text check (char_length(validation_error) <= 1000),
  created_at       timestamptz not null default now()
);
create index generation_runs_tutor_created_idx on generation_runs (tutor_id, created_at desc);
```

**v1.0 からの変更点と理由:**

1. `student_viewers` を追加。v1.0 の設計では「学生アカウントがどの students 行に
   対応するか」を解決できなかった。`students.alias` は架空名なので照合に使えない。
2. `materials_approved_consistency` 制約を追加。「Approved なら approved_content が
   必ずある」をアプリ側だけでなく DB でも保証する。§11 の Integration テストは
   この制約が効いていることを確認する。
3. `generation_runs.tutor_id` と `prompt_version` を追加。レート制限（§8.6）と
   AI 評価（§14）がこの表を参照するため。
4. すべての text 列に長さ制約。「入力検証」を DB 層でも二重化する。

### 4.2 マイグレーション `0002_rls.sql`

RLS（Row Level Security）を全テーブルで有効化する。これが権限管理の中核であり、
面接で説明すべき最重要の技術的判断（§16）。

```sql
alter table profiles        enable row level security;
alter table students        enable row level security;
alter table student_viewers enable row level security;
alter table sessions        enable row level security;
alter table materials       enable row level security;
alter table generation_runs enable row level security;

-- 自分のプロフィールだけ読める
create policy profiles_self_select on profiles
  for select using (id = auth.uid());

-- tutor は自分の担当学生を全操作できる
create policy students_tutor_all on students
  for all using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());

-- student は自分に紐づく学生行だけ読める
create policy students_viewer_select on students
  for select using (
    exists (
      select 1 from student_viewers v
      where v.student_id = students.id and v.profile_id = auth.uid()
    )
  );

create policy viewers_self_select on student_viewers
  for select using (profile_id = auth.uid());

-- セッションは tutor のみ。student には一切見せない（private_notes を含むため）
create policy sessions_tutor_all on sessions
  for all using (
    exists (select 1 from students s where s.id = sessions.student_id and s.tutor_id = auth.uid())
  ) with check (
    exists (select 1 from students s where s.id = sessions.student_id and s.tutor_id = auth.uid())
  );

-- 教材: tutor は自分の学生の全教材
create policy materials_tutor_all on materials
  for all using (
    exists (select 1 from students s where s.id = materials.student_id and s.tutor_id = auth.uid())
  ) with check (
    exists (select 1 from students s where s.id = materials.student_id and s.tutor_id = auth.uid())
  );

-- 教材: student は「自分に紐づく学生」の「approved のみ」
create policy materials_student_approved_select on materials
  for select using (
    status = 'approved'
    and exists (
      select 1 from student_viewers v
      where v.student_id = materials.student_id and v.profile_id = auth.uid()
    )
  );

-- 生成ログは本人のみ
create policy runs_tutor_all on generation_runs
  for all using (tutor_id = auth.uid()) with check (tutor_id = auth.uid());
```

**設計上の要点:**

- `sessions` に student 向けポリシーを**一切書かない**。RLS はデフォルト拒否なので、
  ポリシーがない = 学生からは 0 行に見える。`private_notes` の漏洩経路が
  アプリのバグでは発生しなくなる。
- `materials_student_approved_select` の `status = 'approved'` が製品原則
  「Human in the loop」を DB 層で強制している箇所。
- `ai_draft` 列は approved 行でも student から読めてしまう点に注意。
  **対策:** 学生向けクエリでは `select` する列を `approved_content` のみに限定し、
  `lib/db/queries/materials.ts` の `getApprovedMaterialsForStudent()` に集約する。
  Unit テスト `material-visibility.test.ts` でこの関数の返り値に `ai_draft` と
  `private_notes` が含まれないことを検証する（§11.1）。

### 4.3 シード `0003_seed.sql`（架空データ）

- チューター1名: `Demo Tutor`
- 架空学生3名: `Student A (Algebra)` / `Student B (Calculus)` / `Student C (Statistics)`
- セッション: 学生Aに4件（理解度 2→3→3→4 の推移を作る。P1 のグラフ用）、
  学生Bに2件、学生Cに0件（空状態の確認用）
- 教材: draft 1件 / approved 1件 / rejected 1件 を最低ずつ用意（画面確認用）
- `student_viewers`: 学生アカウントを `Student A` に紐づける

**実在人物を想起させる名前・成績・相談内容を一切入れない。**
seed ファイルの先頭に以下のコメントを置く:

```sql
-- All data below is fictional. Created for portfolio demonstration only.
-- No real student information is used.
```

### 4.4 デモデータのリセット

`supabase/reset-demo.sql` は `truncate students, sessions, materials,
generation_runs, student_viewers cascade;` の後に `0003_seed.sql` を再実行する。
README の「Local Setup」に手順を記載する（DoD 項目「デモデータのリセット手順」）。

---

## 5. 認証と権限モデル

### 5.1 デモログインの実装方式

**採用:** Supabase Auth のメール+パスワード。デモ用アカウント2つを事前に作成し、
ログイン画面に「Tutor としてログイン」「Student としてログイン」の2ボタンを置く。
ボタンを押すとサーバー側で環境変数の資格情報を使ってサインインする。

**採用しなかった方式と理由:**

| 案 | 不採用の理由 |
|---|---|
| Cookie にロールだけ入れる | 認証がないので RLS が使えず、権限管理を証明できない |
| 画面にパスワードを表示して手入力させる | デモ体験が悪い。第三者が説明なしで操作できない（DoD 違反） |
| 匿名認証（anonymous sign-in） | 毎回別ユーザーになり、tutor/student の対応関係が壊れる |

**セキュリティ上の注意:** デモアカウントのパスワードは環境変数に置き、
リポジトリにも画面にも出さない。ログインボタンは Server Action として実装する。

```ts
// app/login/actions.ts
"use server";

export async function loginAsDemoTutor() {
  const supabase = createServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: process.env.DEMO_TUTOR_EMAIL!,
    password: process.env.DEMO_TUTOR_PASSWORD!,
  });
  if (error) return { ok: false, message: "デモログインに失敗しました" };
  redirect("/dashboard");
}
```

### 5.2 ルートガード

```ts
// lib/auth/guards.ts
export async function requireRole(role: "tutor" | "student") {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== role) redirect(profile.role === "tutor" ? "/dashboard" : "/my");
  return profile;
}
```

`app/(tutor)/layout.tsx` で `await requireRole("tutor")`、
`app/(student)/layout.tsx` で `await requireRole("student")` を呼ぶ。

**多層防御:** ガードは UX のため（適切な画面へ誘導する）、RLS はセキュリティのため。
ガードを外してもデータは漏れない、という状態を Integration テストで確認する。

---

## 6. バリデーション層

### 6.1 AI 出力スキーマ `lib/validation/ai-output.ts`（最重要）

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

**v1.0 §11「検証ルール」との対応:**

| v1.0 のルール | 実装 |
|---|---|
| 必須フィールドが存在する | Zod の必須プロパティ（`.optional()` を付けない） |
| 難易度が定義済みの値である | `z.enum(DIFFICULTIES)` |
| 問題数が指定範囲内である | `.min(1).max(5)` + §6.3 の要求数一致チェック |
| ヒントと解答が空でない | `.min(1)` を配列と文字列の両方に |
| 構造検証に失敗した場合は保存しない | `generate.ts` が throw し、`materials` へ insert しない |

### 6.2 生成条件の入力スキーマ `lib/validation/material.ts`

```ts
export const generateRequestSchema = z.object({
  studentId: z.uuid(),
  sessionId: z.uuid().nullable().default(null),
  topic: z.string().trim().min(1).max(100),
  difficulty: z.enum(DIFFICULTIES),
  problemCount: z.number().int().min(1).max(5),
  learningObjective: z.string().trim().min(5).max(300),
});
```

### 6.3 検証の二段構え

構造検証（Zod）を通っても、要求と出力が食い違うことがある。以下を追加チェックする。

```ts
// lib/ai/generate.ts の一部
function assertMatchesRequest(draft: MaterialDraft, req: GenerateRequest) {
  if (draft.problems.length !== req.problemCount) {
    throw new ValidationError(
      `problem count mismatch: requested ${req.problemCount}, got ${draft.problems.length}`
    );
  }
  if (draft.difficulty !== req.difficulty) {
    throw new ValidationError(
      `difficulty mismatch: requested ${req.difficulty}, got ${draft.difficulty}`
    );
  }
}
```

**この関数の存在自体が面接の材料になる**（「スキーマが通っても意味的に正しいとは
限らない」という理解の証明）。AI 評価（§14）の「出力形式」項目で失敗例が出たら
`docs/ai-evaluation.md` に実際のログを載せる。

### 6.4 セッション入力 `lib/validation/session.ts`

```ts
export const sessionInputSchema = z.object({
  studentId: z.uuid(),
  sessionDate: z.iso.date(),
  topic: z.string().trim().min(1).max(100),
  understanding: z.number().int().min(1).max(5),   // Unit テスト対象
  summary: z.string().trim().min(1).max(2000),
  difficultyNotes: z.string().trim().max(2000).optional(),
  nextGoal: z.string().trim().max(500).optional(),
  privateNotes: z.string().trim().max(2000).optional(),
});
```

---

## 7. サーバー API 契約

### 7.1 方針

- 画面からのデータ変更は **Server Actions** を基本とする（フォームと相性が良い）。
- AI 生成だけ **Route Handler**（`POST /api/materials/generate`）にする。理由:
  レート制限・タイムアウト・再試行を1箇所に閉じ込めたいため、および
  クライアントから明示的に fetch してローディング/失敗/再試行の状態を扱いたいため。

### 7.2 Route Handler

| Method | Path | 認可 | Request | Success 200 | Errors |
|---|---|---|---|---|---|
| POST | `/api/materials/generate` | tutor のみ、対象学生の担当者であること | `generateRequestSchema` | `{ materialId, draft }` | 400 検証失敗 / 401 未認証 / 403 他人の学生 / 429 上限超過 / 502 AI失敗 / 422 AI出力が不正 |
| GET | `/api/health` | 不要 | — | `{ ok: true }` | — |

エラー応答は共通形式に統一する:

```ts
type ApiError = {
  error: {
    code: "VALIDATION" | "UNAUTHORIZED" | "FORBIDDEN"
        | "RATE_LIMITED" | "AI_UNAVAILABLE" | "AI_INVALID_OUTPUT";
    message: string;     // 画面にそのまま出せる日本語
    retryable: boolean;  // 再試行ボタンを出すか
  };
};
```

**個人情報をエラーログに残さない**（v1.0 §14）ため、`console.error` には
`{ code, materialId, tutorId, latencyMs }` のみを出す。プロンプト本文と
AI 応答本文はログに出さない。

### 7.3 Server Actions 一覧

| Action | ファイル | 認可 | 主な検証 |
|---|---|---|---|
| `createStudent` | `app/(tutor)/students/actions.ts` | tutor | alias 必須 |
| `updateStudent` | 同上 | tutor + 担当者 | — |
| `deactivateStudent` | 同上 | tutor + 担当者 | 論理削除（`active=false`） |
| `createSession` | `app/(tutor)/sessions/actions.ts` | tutor + 担当者 | `sessionInputSchema` |
| `updateSession` | 同上 | tutor + 担当者 | 同上 |
| `deleteSession` | 同上 | tutor + 担当者 | 確認ダイアログ必須 |
| `approveMaterial` | `app/(tutor)/materials/actions.ts` | tutor + 担当者 | 編集後内容が `materialDraftSchema` を通ること／`status=draft` からのみ遷移可 |
| `rejectMaterial` | 同上 | tutor + 担当者 | 却下理由は任意、500字以内 |
| `saveMaterialEdit` | 同上 | tutor + 担当者 | 承認せず編集内容だけ保存（`approved_content` に入れ、status は draft のまま） |

**状態遷移の制約:** `draft → approved` / `draft → rejected` のみ許可する。
`approved → draft` の差し戻しは P2。実装では Server Action 内で
`if (material.status !== "draft") throw` を書き、Integration テストで確認する。

---

## 8. AI 連携設計

### 8.1 モデル選定と料金

| モデル | モデルID | 入力 $/1M | 出力 $/1M | 本プロジェクトでの位置づけ |
|---|---|---|---|---|
| Claude Opus 5 | `claude-opus-5` | $5.00 | $25.00 | **既定**。数学的正確さが作品の核心なので最上位の実用モデルを使う |
| Claude Sonnet 5 | `claude-sonnet-5` | $3.00（2026-08-31まで $2.00） | $15.00（同 $10.00） | コストを抑えたい場合の代替 |
| Claude Haiku 4.5 | `claude-haiku-4-5` | $1.00 | $5.00 | AI評価10ケースを何度も回す際の下見用 |

モデルは `AI_MODEL` 環境変数で切り替えられるようにする。`generation_runs.model_label`
に実際に使ったモデルIDを保存し、`docs/ai-evaluation.md` にどのモデルで評価したかを
明記する（v1.0 §12「AIモデルの性能を誇張しない」）。

**費用見積り:** 1回の生成でプロンプト約 1,200 トークン、出力約 1,500 トークン。
Opus 5 なら 1回あたり約 $0.044。開発中に 200 回生成しても $9 程度。
月上限 20 USD で十分に収まる。

### 8.2 構造化出力の実装

Claude API の **Structured Outputs**（`output_config.format`）を使う。JSON Schema を
渡すと出力がスキーマに適合することが保証される。SDK の `messages.parse()` +
`zodOutputFormat()` を使えば §6.1 の Zod スキーマをそのまま流用できる。

```ts
// lib/ai/client.ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic();  // ANTHROPIC_API_KEY を環境から読む
```

```ts
// lib/ai/generate.ts
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client";
import { materialDraftSchema, type MaterialDraft } from "@/lib/validation/ai-output";
import { SYSTEM_PROMPT, buildUserPrompt, PROMPT_VERSION } from "./prompt";
import type { GenerateRequest } from "@/lib/validation/material";

export class AiUnavailableError extends Error {}
export class AiInvalidOutputError extends Error {}

export async function generateMaterialDraft(
  req: GenerateRequest
): Promise<{ draft: MaterialDraft; latencyMs: number; modelLabel: string }> {
  const model = process.env.AI_MODEL ?? "claude-opus-5";
  const started = Date.now();

  let response;
  try {
    response = await anthropic.messages.parse({
      model,
      max_tokens: 16000,        // thinking + 応答本文の合計上限。余裕を持たせる
      output_config: {
        effort: (process.env.AI_EFFORT ?? "medium") as "low" | "medium" | "high",
        format: zodOutputFormat(materialDraftSchema),
      },
      system: SYSTEM_PROMPT,     // 固定文字列。プロンプトキャッシュが効く
      messages: [{ role: "user", content: buildUserPrompt(req) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new AiUnavailableError("rate_limited");
    if (e instanceof Anthropic.APIConnectionError) throw new AiUnavailableError("network");
    if (e instanceof Anthropic.APIError) throw new AiUnavailableError(`api_${e.status}`);
    throw e;
  }

  const latencyMs = Date.now() - started;

  // 安全側チェック: 拒否・トークン切れ・パース失敗
  if (response.stop_reason === "refusal") {
    throw new AiInvalidOutputError("refused_by_safety_classifier");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiInvalidOutputError("truncated_output");
  }
  if (!response.parsed_output) {
    throw new AiInvalidOutputError("schema_parse_failed");
  }

  const draft = response.parsed_output;
  assertMatchesRequest(draft, req);   // §6.3
  return { draft, latencyMs, modelLabel: model };
}
```

**実装上の注意点（面接で説明できるようにしておく）:**

1. `max_tokens` は **thinking と応答本文の合計** の上限。Claude Opus 5 は
   thinking が既定で有効なので、応答本文のサイズだけで見積もると途中で切れる。
   16000 に設定し、`stop_reason === "max_tokens"` を明示的にエラー扱いする。
2. `temperature` / `top_p` は Claude Opus 5 では**受け付けられない**（400 になる）。
   出力の揺らぎはプロンプトで制御する。
3. `stop_reason === "refusal"` を必ず先に確認してから `content` を読む。
   安全性分類器が応答を拒否した場合、成功扱いの HTTP 200 が返る。
4. `system` を固定文字列にすることでプロンプトキャッシュが効く（Opus 5 の
   キャッシュ最小は 512 トークン）。可変部分は `messages` 側に置く。
5. `parsed_output` は失敗時 `null` になりうるので必ずチェックする。

### 8.3 プロンプト設計 `lib/ai/prompt.ts`

```ts
export const PROMPT_VERSION = "v1";

export const SYSTEM_PROMPT = `You are assisting a human mathematics tutor by drafting practice materials.

Your output is a DRAFT. A human tutor reviews, edits, and approves it before any
student sees it. Never address the student directly.

Rules:
- Write problems that are solvable with the stated topic and difficulty alone.
- Hints must be progressive: the first hint points at the approach, the last hint
  gets close to the method but never states the final answer.
- solution_steps must show the intermediate work, not just the final answer.
- common_mistakes must describe errors a real learner makes, not trivia.
- Use plain-text math notation (x^2, sqrt(2), (a+b)/c). Do not use LaTeX.
- Never include names, identifiers, or any information about real people.
- Always set review_warning to: "AI-generated draft. Verify all mathematics before approval."

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

**`PROMPT_VERSION` の運用:** プロンプトを変えたら `v2`, `v3` と上げ、
`materials.prompt_version` に保存する。AI 評価（§14）は必ずバージョンを明記して
実施する。これにより「評価結果がどのプロンプトのものか」を後から説明できる。

**プロンプトに個人情報を含めない設計:** `buildUserPrompt` は `topic` /
`difficulty` / `problemCount` / `learningObjective` の4つしか受け取らない。
`students.alias` も `sessions.private_notes` も型として渡せない。
これは v1.0 §7 のシーケンス図「個人情報を含まない条件を送信」を
関数シグネチャで強制した形。

### 8.4 生成フロー全体（Route Handler）

```
POST /api/materials/generate
  1. 認証確認 → 401
  2. Zod で入力検証 → 400
  3. 対象学生の担当者か確認 → 403
  4. レート制限確認 → 429
  5. generateMaterialDraft() 実行
       失敗 → generation_runs に success=false で記録 → 502 / 422
  6. materials へ status='draft' で insert
  7. generation_runs に success=true で記録（material_id 付き）
  8. 200 { materialId, draft }
```

**失敗もログに残す**のが要点。`generation_runs` に失敗記録が残るので、
`docs/ai-evaluation.md` に実際の失敗率を書ける（v1.0 §12「失敗例を一つ以上掲載」）。

### 8.5 再試行の設計

- SDK は 429 と 5xx を既定で 2 回まで自動再試行する（指数バックオフ）。
- それでも失敗したら画面に「生成に失敗しました。再試行しますか？」を出す。
  再試行ボタンは同じ条件で `POST` をもう一度叩くだけ（サーバー側で状態を持たない）。
- `AiInvalidOutputError`（構造検証失敗）は自動再試行**しない**。人間が条件を
  見直すべき状況なので、エラー内容を画面に出して手動再試行に委ねる。

### 8.6 レート制限とコスト管理

```ts
// lib/ai/rate-limit.ts
export async function checkGenerationLimit(tutorId: string) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("generation_runs")
    .select("id", { count: "exact", head: true })
    .eq("tutor_id", tutorId)
    .gte("created_at", since);

  const limit = Number(process.env.GENERATION_RATE_LIMIT_PER_HOUR ?? 10);
  if ((count ?? 0) >= limit) {
    throw new RateLimitError(`1時間あたり${limit}回までです。しばらくお待ちください。`);
  }
}
```

DB を数えるだけの実装にする理由: 公開デモの利用者は1〜2人であり、Redis 等の
外部依存を増やす価値がない。この判断も面接で説明できる（「要件に対して最小の
実装を選んだ」）。

**多層のコスト防御:**
1. アプリ側レート制限（上記）
2. `problemCount` の上限 5（プロンプトが肥大化しない）
3. Anthropic Console の使用量アラート 20 USD
4. Vercel の環境変数で本番のみ `AI_EFFORT=low` にする選択肢を残す

---

## 9. 画面仕様と受け入れ基準

### 9.1 Landing `/`

- 作品名、1文説明、「これは DVC の公式製品ではない」「全データは架空」の明記
- デモの使い方（Tutor と Student の2アカウント）
- GitHub リンク、About ページへのリンク
- **受け入れ基準:** 初見の第三者がこのページだけ読んで、次に何を押せばよいか分かる

### 9.2 Demo Login `/login`

- 「Tutor としてデモを開始」「Student としてデモを開始」の2ボタン
- 各ボタンの下に「このアカウントで何ができるか」を1行で説明
- **受け入れ基準:** パスワード入力なしで両方のロールを試せる

### 9.3 Tutor Dashboard `/dashboard`

- 担当学生数、直近セッション5件、**未承認 Draft 件数（強調表示）**
- 未承認が0件のときは空状態メッセージ
- **受け入れ基準:** 未承認 Draft から1クリックで Material Review に行ける

### 9.4 Student List `/students` / Detail `/students/[id]`

- 一覧: alias / current_level / learning_goal / 最終セッション日
- 詳細: 学習目標、セッション履歴（新しい順）、この学生の教材一覧（status 付き）
- **受け入れ基準:** 学生0件のとき「最初の架空学生を追加する」導線が出る

### 9.5 Session Editor `/sessions/new`, `/sessions/[id]/edit`

- 理解度は 1〜5 のラジオまたはセグメント（数値入力にしない = 異常値が入らない）
- `private_notes` の入力欄には「学生には表示されません」と明記
- **受け入れ基準:** 必須項目未入力で送信すると、どの項目が問題かフィールド単位で表示される

### 9.6 Material Generator `/materials/new`

- 入力: 学生（選択）、関連セッション（任意）、分野、難易度、問題数、学習目標
- 生成中: ボタンを無効化し、スピナーと「生成には30秒ほどかかります」を表示
- 失敗時: エラー種別ごとの日本語メッセージ + 再試行ボタン
- **受け入れ基準:** 生成中に二重送信できない。失敗しても入力内容が消えない

### 9.7 Material Review `/materials/[id]` — **作品の中心**

v1.0 §15 の指定通り、この画面を最も作り込む。

**レイアウト（デスクトップ）:**

```
┌─────────────────────────────────────────────────────────┐
│ [DRAFT] Quadratic equations / standard   Student A      │
│ ⚠ AI-generated draft. Verify all mathematics.           │
├───────────────────────────┬─────────────────────────────┤
│  AI 原案（読み取り専用）   │  確認・修正後（編集可）       │
│                           │                             │
│  Problem 1                │  Problem 1                  │
│  x^2 - 5x + 6 = 0 を解け  │  [編集可能なテキストエリア]  │
│  Hints (2)                │  Hints (2)  [+ 追加]        │
│  Solution steps (2)       │  Solution steps (2)         │
│  Common mistakes (1)      │  Common mistakes (1)        │
├───────────────────────────┴─────────────────────────────┤
│ Human Review Checklist                                  │
│ □ 問題は解けるか  □ 解答は正しいか  □ 難易度は合うか     │
│ □ ヒントが答えを明かしていないか  □ 説明に飛躍がないか   │
│ □ 不適切な表現がないか  □ 個人情報が混入していないか     │
├─────────────────────────────────────────────────────────┤
│        [ 却下 ]   [ 下書き保存 ]   [ 承認して公開 ]      │
└─────────────────────────────────────────────────────────┘
```

**仕様:**
- 左右で差分がある箇所に視覚的マーカーを付ける（変更済みバッジ）
- チェックリストは v1.0 §11 の Human Review Checklist をそのまま実装
- **承認ボタンはチェックリスト全項目にチェックが入るまで無効**
  （「人間が責任を持つ」設計を UI で強制する。作品の主張そのもの）
- ステータスは色だけでなく**文字でも**表示（`[DRAFT]` / `[APPROVED]`）
- モバイルでは左右を上下タブに切り替える
- **受け入れ基準:** 承認済みの教材を開くと編集不可の閲覧モードになる

### 9.8 Student View `/my`

- 承認済み教材のみ。Draft は件数すら表示しない
- ヒントは `<details>` ベースの段階開示（1つずつ開く）
- 解答は「解答を表示」を押すまで DOM に存在しない（サーバーから取得するのではなく、
  クライアントで条件レンダリング。P0 ではこれで十分）
- 画面下部に「この教材はチューターが確認済みです」を表示
- **受け入れ基準:** ブラウザの開発者ツールで DOM を検索しても `private_notes` と
  `ai_draft` の文字列が出てこない

### 9.9 About / Architecture `/about`

- 技術構成図（Mermaid をビルド時に SVG 化、または静的画像）
- AI をどこで使い、人間が何を判断しているかの説明
- 既知の制約・注意事項

---

## 10. UI 共通仕様

### 10.1 状態表現の統一

すべてのデータ表示領域は4状態を持つ。共通コンポーネントで実装する。

| 状態 | コンポーネント | 内容 |
|---|---|---|
| 読み込み中 | `<LoadingState />` | スケルトンまたはスピナー + 説明文 |
| 空 | `<EmptyState />` | 「まだ〜がありません」+ 次の行動への導線 |
| 失敗 | `<ErrorState />` | 何が起きたか + 再試行ボタン |
| 正常 | — | — |

**Day 7 のチェック項目:** 全画面で空状態と失敗状態を実際に発生させ、
スクリーンショットを撮る（`docs/screenshots/states/`）。

### 10.2 アクセシビリティ（P0 で守る最低限）

- すべての入力に `<label>` を関連付ける
- 承認/却下ボタンは Tab で到達でき、Enter で実行できる
- ステータスは色に依存しない（文字を併記）
- `<html lang="ja">`（P1 で言語切替時に動的化）
- フォーカスリングを消さない

### 10.3 デザイン方針

- B2B SaaS 的な落ち着いたトーン。装飾的イラスト・キャラクターは使わない
- DVC のロゴ・校章・公式サービスを想起させる配色や名称を使わない
- 数式が読める行間（`leading-relaxed`）と本文 16px 以上
- 色数を絞る: 基調色1 + アクセント1 + ステータス3（draft=amber, approved=green,
  rejected=slate）

---

## 11. テスト計画

### 11.1 Unit（Vitest）

**`tests/unit/ai-output.test.ts`**

| ケース名 | 期待 |
|---|---|
| `accepts a valid draft` | パース成功 |
| `rejects missing problems field` | 失敗 |
| `rejects unknown difficulty value` | 失敗（`"hard"` を渡す） |
| `rejects empty hints array` | 失敗 |
| `rejects empty solution_steps array` | 失敗 |
| `rejects a hint that is an empty string` | 失敗 |
| `rejects more than 5 problems` | 失敗 |
| `assertMatchesRequest rejects problem count mismatch` | throw |
| `assertMatchesRequest rejects difficulty mismatch` | throw |

**`tests/unit/session-validation.test.ts`**

| ケース名 | 期待 |
|---|---|
| `rejects understanding = 0` | 失敗 |
| `rejects understanding = 6` | 失敗 |
| `rejects understanding = 3.5` | 失敗（整数制約） |
| `accepts understanding 1 through 5` | 5件すべて成功 |
| `rejects empty summary` | 失敗 |
| `rejects summary over 2000 chars` | 失敗 |
| `trims whitespace-only topic to empty and rejects` | 失敗 |

**`tests/unit/material-visibility.test.ts`**

| ケース名 | 期待 |
|---|---|
| `toStudentView omits ai_draft` | 返り値に `ai_draft` キーがない |
| `toStudentView omits rejection_reason` | 同上 |
| `toStudentView returns approved_content only` | — |
| `filterForStudent excludes draft materials` | draft を含む配列を渡すと0件 |
| `filterForStudent excludes rejected materials` | 同上 |

### 11.2 Integration（Vitest + テスト用 Supabase プロジェクト）

**`tests/integration/permissions.test.ts`**

| ケース名 | 期待 |
|---|---|
| `tutor can create student and session` | 成功 |
| `student cannot read sessions table at all` | 0 行（RLS） |
| `student cannot read draft materials` | 0 行 |
| `student can read approved materials of own student` | 1 行以上 |
| `student cannot read approved materials of another student` | 0 行 |
| `tutor cannot read another tutor's students` | 0 行 |

**`tests/integration/material-approval.test.ts`**

| ケース名 | 期待 |
|---|---|
| `approving sets approved_at and status` | `approved_at` が非 null |
| `db rejects approved status without approved_content` | 制約違反エラー |
| `approving twice is rejected` | 2回目でエラー（状態遷移制約） |
| `rejecting stores rejection_reason` | 保存される |
| `failed generation is recorded with success=false` | `generation_runs` に1行 |
| `rate limit blocks the 11th generation in an hour` | 429 相当のエラー |

### 11.3 E2E（Playwright）

**`tests/e2e/tutor-to-student.spec.ts`** — v1.0 §20 のシナリオそのまま1本。

```
1. / を開く → 「Tutor としてデモを開始」
2. ダッシュボードで学生 A を選ぶ
3. セッションを記録（理解度3）→ 保存されたことを確認
4. 教材生成フォームで条件を入力 → 生成（AI 呼び出しはモックする）
5. Material Review で問題文を編集
6. チェックリストを全てチェック → 承認
7. ログアウト →「Student としてデモを開始」
8. /my に承認済み教材が1件表示され、Draft が表示されないことを確認
```

**AI 呼び出しのモック:** E2E で実 API を叩くと不安定かつ有料になる。
`PLAYWRIGHT_MOCK_AI=1` のとき `lib/ai/generate.ts` が固定 JSON を返すようにする。
この分岐は `process.env.NODE_ENV !== "production"` でさらにガードする。

### 11.4 Manual チェックリスト（Day 8）

- [ ] iPhone サイズ（375px）で全画面の主要操作が可能
- [ ] キーボードのみで「ログイン→承認」まで到達できる
- [ ] 長い数式（100文字以上）が折り返して読める
- [ ] AI API キーを無効値にして失敗表示を確認
- [ ] 学生0件・セッション0件・教材0件の空状態を確認
- [ ] 日本語と英語の混在テキストが崩れない

---

## 12. CI とデプロイ

### 12.1 `.github/workflows/ci.yml`

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

**設計判断:** Integration と E2E は CI に含めない（Supabase の
テストプロジェクトと API キーが必要で、初回構築のコストが高い）。
代わりに **ローカルで実行して結果を README に記載する**。
この判断とその理由を README の Testing 節に正直に書く
（v1.0 §16「実装していない機能を README へ書かない」の精神）。

`package.json` の scripts:

```json
{
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "test:e2e": "playwright test"
}
```

### 12.2 デプロイ手順（Day 8）

1. Vercel に GitHub リポジトリを接続
2. 環境変数を Production / Preview の両方に設定（`.env.example` の全項目）
3. Supabase 本番プロジェクトにマイグレーション3本を適用
4. デモアカウント2つを Supabase Auth に作成し、`profiles` 行を挿入
5. `0003_seed.sql` を実行
6. 公開 URL で E2E シナリオを手動でなぞる
7. `/api/health` が 200 を返すことを確認
8. モバイル実機で確認

---

## 13. 10日間の作業分解（43チケット）

各チケットは「完了条件」を満たしたら次へ進む。1日の終わりに DEVLOG.md を更新する。

### Phase 0（30〜60分・コードを書かない）

| ID | 作業 | 完了条件 |
|---|---|---|
| P0-1 | v1.0 §27 の5問に回答し、実体験と仮説を分ける | メモが残っている |
| P0-2 | Anthropic Console で API キー発行 + 使用量アラート設定 | アラート設定のスクリーンショット |
| P0-3 | Supabase プロジェクト作成（dev / prod の2つ） | 接続情報が手元にある |
| P0-4 | GitHub リポジトリ作成（public） | URL が存在する |

### Day 1: 土台と CI

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D1-1 | `create-next-app`（TS, Tailwind, App Router） | `npm run dev` が起動 | `chore: initialize Next.js and CI` |
| D1-2 | `tsconfig` を `strict: true`、`.nvmrc` 作成 | `npm run typecheck` が通る | 同上 |
| D1-3 | `.gitignore` に `.env*` 追加、`.env.example` 作成 | `git status` に .env が出ない | 同上 |
| D1-4 | `ci.yml` 作成 | GitHub Actions が緑 | 同上 |
| D1-5 | README に背景・目的・免責を書く | v1.0 §14 の注意書き3行が入っている | `docs: define product problem and MVP scope` |
| D1-6 | `DEVLOG.md` / `AI_USAGE.md` の雛形作成 | ファイルが存在する | 同上 |

**完了条件（日次）:** 空のアプリがローカルで動き、GitHub Actions が通る。

### Day 2: DB とデモログイン

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D2-1 | `0001_init.sql` を適用 | dev DB に5テーブル+1中間テーブル | `feat: add database schema and RLS policies` |
| D2-2 | `0002_rls.sql` を適用 | 全テーブルで RLS 有効 | 同上 |
| D2-3 | `supabase gen types` で `lib/db/types.ts` 生成 | 型が import できる | 同上 |
| D2-4 | デモアカウント2つ作成 + `profiles` 行挿入 | Supabase 管理画面で確認 | — |
| D2-5 | `0003_seed.sql` 作成・適用 | 学生3名・セッション6件・教材3件 | 同上 |
| D2-6 | Supabase クライアント（client/server）実装 | サーバーから select できる | `feat: add demo authentication and roles` |
| D2-7 | `/login` と2つのデモログイン Server Action | 両ロールでログインできる | 同上 |
| D2-8 | `requireRole` と2つの layout ガード | tutor が `/my` に行くと `/dashboard` に飛ぶ | 同上 |

**完了条件:** チューターと学生で見える画面が分かれる。

### Day 3: 学生・セッション CRUD

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D3-1 | `lib/validation/student.ts` + `session.ts` | Zod スキーマ完成 | `feat: add student and session management` |
| D3-2 | UI プリミティブ（Button/Input/Select/Badge/Card） | Storybook 不要、実画面で確認 | 同上 |
| D3-3 | `EmptyState` / `ErrorState` / `LoadingState` | 3コンポーネント完成 | 同上 |
| D3-4 | 学生一覧 + 追加フォーム | 追加した学生が一覧に出る | 同上 |
| D3-5 | 学生詳細（目標・履歴・教材タブ） | 3セクション表示 | 同上 |
| D3-6 | セッション作成・編集・削除 | 全操作が動く | 同上 |
| D3-7 | フィールド単位のエラー表示 | 空 summary で送信するとその欄に赤字 | 同上 |
| D3-8 | Dashboard（学生数・直近セッション・未承認数） | 3ブロック表示 | 同上 |

**完了条件:** AI なしでも学習記録アプリとして使える。

### Day 4: AI 教材案生成

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D4-1 | `lib/validation/ai-output.ts`（Zod） | §11.1 の Unit テストが通る | `feat: generate structured material drafts` |
| D4-2 | `tests/unit/ai-output.test.ts` を先に書く | 9ケース通過 | `test: cover AI output validation` |
| D4-3 | `lib/ai/prompt.ts`（SYSTEM_PROMPT + v1） | 定数が完成 | `feat: generate structured material drafts` |
| D4-4 | `lib/ai/generate.ts`（構造化出力 + エラー分類） | CLI スクリプトで1件生成できる | 同上 |
| D4-5 | `assertMatchesRequest` 実装 | 問題数不一致で throw | 同上 |
| D4-6 | `lib/ai/rate-limit.ts` | 11回目で throw | 同上 |
| D4-7 | `POST /api/materials/generate` | Draft が DB に入る | 同上 |
| D4-8 | `generation_runs` への記録（成功・失敗とも） | 失敗時も1行増える | 同上 |
| D4-9 | Material Generator 画面（ローディング/失敗/再試行） | 3状態が確認できる | 同上 |

**完了条件:** 架空条件から教材案を生成し、Draft として表示できる。

### Day 5: レビュー・承認 — **MVP 到達点**

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D5-1 | `MaterialDiff` コンポーネント（左右2カラム） | 原案と編集後が並ぶ | `feat: add human review and approval workflow` |
| D5-2 | `ProblemEditor`（問題・ヒント・解答の編集） | 編集内容が state に反映 | 同上 |
| D5-3 | Human Review Checklist（7項目） | 全チェックまで承認ボタン無効 | 同上 |
| D5-4 | `approveMaterial` Action（状態遷移制約付き） | approved_at が入る | 同上 |
| D5-5 | `rejectMaterial` Action | rejection_reason が入る | 同上 |
| D5-6 | `saveMaterialEdit` Action | status は draft のまま保存 | 同上 |
| D5-7 | `StatusBadge`（文字+色） | 3状態を文字で判別可能 | 同上 |
| D5-8 | 学生画面に approved のみ表示 | draft が出ない | `feat: show approved materials in student view` |
| D5-9 | `tests/integration/permissions.test.ts` | 6ケース通過 | `test: cover validation and approval permissions` |

**完了条件:** 中心フローが最初から最後まで動く。**この時点で GitHub を
「開発中」として就活に掲載できる**（v1.0 §25 のリスク対策）。

### Day 6: 学生画面と進捗

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D6-1 | `HintDisclosure`（段階開示） | ヒントを1つずつ開ける | `feat: show approved materials in student view` |
| D6-2 | 解答の表示制御 | 押すまで DOM に出ない | 同上 |
| D6-3 | `toStudentView` / `filterForStudent` + Unit テスト | §11.1 の5ケース通過 | `test: cover student view data filtering` |
| D6-4 | 学生詳細のセッション履歴表示 | 時系列で並ぶ | 同上 |
| D6-5 | 簡易進捗（理解度の直近5件を数値で） | 表示される | 同上 |
| D6-6 | Landing / About ページ | 免責と構成説明が入る | `docs: add architecture and AI usage notes` |

### Day 7: 品質

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| D7-1 | `tests/integration/material-approval.test.ts` | 6ケース通過 | `test: cover validation and approval permissions` |
| D7-2 | E2E シナリオ1本 + AI モック | Playwright が緑 | 同上 |
| D7-3 | API キー露出チェック（`grep` 検証） | 0件のスクリーンショット取得 | `fix: handle generation failure and empty states` |
| D7-4 | 全画面の空状態・失敗状態を実際に発生させ確認 | スクリーンショット取得 | 同上 |
| D7-5 | エラーメッセージの日本語見直し | 技術用語が画面に出ない | 同上 |
| D7-6 | ログに個人情報が出ないことを確認 | ログ出力箇所を全て確認 | 同上 |

### Day 8: 公開

| ID | 作業 | 完了条件 |
|---|---|---|
| D8-1 | 本番 Supabase にマイグレーション適用 | テーブルが存在 |
| D8-2 | 本番デモアカウント + seed 投入 | ログインできる |
| D8-3 | Vercel デプロイ + 環境変数設定 | 公開 URL が動く |
| D8-4 | 公開 URL で E2E シナリオを手動実行 | 全ステップ成功 |
| D8-5 | モバイル実機確認（§11.4） | チェックリスト完了 |
| D8-6 | 第三者に説明なしで触ってもらう | 詰まった箇所をメモ |
| D8-7 | D8-6 で見つかった導線の問題を修正 | 修正済み |

### Day 9: ドキュメント

| ID | 作業 | 完了条件 |
|---|---|---|
| D9-1 | README を §22 の構成で完成 | 全17節が埋まる |
| D9-2 | `docs/architecture.md` + 構成図 | Mermaid 図が入る |
| D9-3 | `docs/data-model.md` | ER 図と各表の説明 |
| D9-4 | スクリーンショット6枚以上 | Material Review を含む |
| D9-5 | AI 評価10ケース実施（§14） | `docs/ai-evaluation.md` 完成 |
| D9-6 | `AI_USAGE.md` を実際の内容で埋める | 5項目が具体的 |
| D9-7 | `DEVLOG.md` を10日分整える | 日次で問題と解決が書かれている |
| D9-8 | 既知の問題・今後の改善を README に | 正直に書く |

### Day 10: 就活用仕上げ

| ID | 作業 | 完了条件 |
|---|---|---|
| D10-1 | 残った不具合の修正 | Issue が0件 |
| D10-2 | 90秒説明を書いて声に出して計測 | 90秒以内 |
| D10-3 | 5分デモの手順を書いて実演練習 | 5分以内 |
| D10-4 | 履歴書・職務経歴書用の説明文（v1.0 §23） | 実装済み機能のみ記載 |
| D10-5 | GitHub のリポジトリをピン留め、説明文と topics 設定 | 完了 |
| D10-6 | 公開 URL の最終確認（別ブラウザ・シークレット） | 動く |
| D10-7 | §16 の想定質問に自分の言葉で回答を用意 | メモ完成 |

---

## 14. AI 評価の実施手順（Day 9）

### 14.1 手順

1. `PROMPT_VERSION` と `AI_MODEL` を記録する
2. 以下10分野 × 難易度 `standard` × 問題数 2 で生成する
   一次方程式 / 連立方程式 / 二次方程式 / 関数 / 指数・対数 /
   三角関数 / 微分 / 積分 / 確率 / 文章題
3. 生成結果の JSON をすべて `docs/evaluation-raw/` に保存する
4. v1.0 §12 の5項目 × 0〜2点で採点する（満点10点）
5. 結果表と失敗例を `docs/ai-evaluation.md` に書く

### 14.2 `docs/ai-evaluation.md` の雛形

```markdown
# AI Output Evaluation

- Model: claude-opus-5
- Prompt version: v1
- Date: 2026-08-XX
- Cases: 10 topics × standard difficulty × 2 problems
- Evaluator: 開発者本人（数学チューター経験あり）

## Scoring

| # | Topic | 数学的正確さ | 難易度一致 | ヒント品質 | 解答手順 | 出力形式 | 計 |
|---|---|---|---|---|---|---|---|
| 1 | Linear equations | 2 | 2 | 2 | 2 | 2 | 10 |
| ... |

Total: XX / 100

## 失敗例（必須：1件以上）

### Case N: <分野>

生成された内容:
```json
...
```

問題点: <何が誤っていたか>
検出方法: <構造検証で弾けたか／人間のレビューで気づいたか>
対応: <プロンプト修正／レビュー手順の追加／未対応>

## 所感

- 構造検証で防げた失敗: N件
- 人間のレビューでしか防げなかった失敗: N件
- この結果が示すこと: <承認フローが必要である根拠を自分の言葉で>
```

**「人間のレビューでしか防げなかった失敗」の件数がこの作品の主張の証拠になる。**
0件だった場合は、より難しい分野（積分・確率）で追加ケースを実施する。

---

## 15. ドキュメント成果物

### 15.1 `AI_USAGE.md` の書き方

抽象論ではなく**具体的な事例**を書く。以下のような粒度を目安にする。

```markdown
## AI を使った作業

- Zod スキーマの初稿生成（`lib/validation/ai-output.ts`）
- RLS ポリシーの文法確認
- Playwright セレクタの書き方の調査
- README の英語表現の校正

## 採用しなかった AI の提案

- ORM（Prisma）の導入提案 → テーブル5個に対して過剰と判断し、
  Supabase クライアント + 型生成を選択した
- 生成失敗時の無限リトライ → 費用上限を超えるため、
  構造検証エラーは自動再試行しない設計に変更した

## AI 生成コードで実際に起きた問題

- （実際に起きたことを Day 1〜10 の DEVLOG から転記する）

## 自分で行った検証

- 生成された RLS ポリシーが本当に効くかを Integration テストで確認した
- AI 出力の JSON がスキーマを通っても問題数が要求と違う場合があり、
  `assertMatchesRequest` を自分で追加した
```

### 15.2 `DEVLOG.md` の書式

```markdown
## 2026-08-XX（Day N）

**実装したもの:** <チケットID と内容>
**発生した問題:** <具体的に>
**原因:** <調べた結果>
**解決方法:** <何をしたか>
**次に行うこと:** <明日の先頭チケット>
```

毎日書く。面接の「一番難しかったバグは何か」への回答はここから作る。

---

## 16. 面接で説明すべき技術的判断

各段階で「なぜそうしたか」を1〜2文で言えるようにしておく。

| # | 判断 | 説明の骨子 |
|---|---|---|
| 1 | 権限を RLS（DB層）に置いた | アプリのバグで学生に private_notes が漏れる経路を構造的に塞ぐため。ポリシーがなければデフォルト拒否になる |
| 2 | `sessions` に学生向けポリシーを書かなかった | 「見せない」を実装するより「そもそもポリシーを書かない」ほうが安全だから |
| 3 | AI 出力を JSON Schema で拘束した | 自由文をパースすると失敗ケースが無限にある。構造を保証したうえで、内容の正しさは人間が見る、と役割を分けた |
| 4 | それでも `assertMatchesRequest` を足した | スキーマ適合と要求充足は別問題。問題数5を要求して3件返ることがあった |
| 5 | 構造検証エラーは自動再試行しない | 同じ条件で再送しても同じ失敗を繰り返す可能性が高く、費用だけ増えるため |
| 6 | `max_tokens` を大きめに取った | Claude Opus 5 は思考と応答の合計が上限。応答サイズだけで見積もると途中で切れる |
| 7 | 承認ボタンをチェックリスト完了まで無効化した | 「人間が確認した」を UI で強制する。作品の主張を機能で表現した箇所 |
| 8 | プロンプトに学生情報を渡せない関数シグネチャにした | 「気をつける」ではなく型で防ぐ |
| 9 | `prompt_version` を DB に持った | 評価結果がどのプロンプトのものか後から説明できるようにするため |
| 10 | Integration/E2E を CI に入れなかった | 外部依存の構築コストが期間に見合わないと判断。README に正直に書いた |
| 11 | レート制限を DB カウントで実装した | 利用者1〜2人のデモに Redis を持ち込む価値がないため |
| 12 | ORM を入れなかった | テーブル5個。学習コストを AI 連携の理解に配分した |

---

## 17. リスクと縮退ルール

v1.0 §25 のリスク表に、**具体的な縮退判断**を追加する。

| 時点 | 判定 | 縮退内容 |
|---|---|---|
| Day 3 終了時 | CRUD が動いていない | UI プリミティブの作り込みを止め、素の HTML + Tailwind で進める |
| Day 4 終了時 | 生成が動いていない | 問題数を1固定にし、`common_mistakes` を任意にしてスキーマを緩める |
| Day 5 終了時 | 承認フローが未完 | **P1 を全て破棄**。Day 6 も承認フローに充てる |
| Day 6 終了時 | MVP 未完 | 学生画面を「承認済み教材の一覧表示のみ」に縮小（段階ヒントを P1 送り） |
| Day 7 終了時 | E2E が書けない | E2E を諦め、Manual チェックリストの実行記録を README に載せる（DoD の該当項目を「未達」と明記する） |

**縮退したことを隠さない。** README の Known Limitations に何を落としたかと
理由を書く。これは減点ではなく、判断できることの証明になる。

---

## 18. Definition of Done（v1.0 §21 + 検証方法）

| # | 条件 | 検証方法 |
|---|---|---|
| 1 | 公開 URL がある | シークレットウィンドウで開く |
| 2 | デモログイン方法が明確 | 第三者が説明なしでログインできた（D8-6） |
| 3 | 学生・セッション CRUD が動く | E2E ステップ2〜3 |
| 4 | AI 教材案を生成できる | E2E ステップ4（本番は手動確認） |
| 5 | Draft を人間が修正・承認できる | E2E ステップ5〜6 |
| 6 | 学生画面には Approved だけ | E2E ステップ8 + Integration テスト |
| 7 | 実在学生の情報を使っていない | seed ファイルのレビュー |
| 8 | API キーが公開されていない | `grep -r "sk-ant" .next/` が0件 |
| 9 | lint / typecheck / test が通る | GitHub Actions が緑 |
| 10 | 主要フローの E2E がある | `npx playwright test` が緑 |
| 11 | README に背景・技術・構成・起動方法 | §22 の17節が埋まっている |
| 12 | `AI_USAGE.md` がある | 具体例が入っている |
| 13 | AI 評価結果と失敗例がある | `docs/ai-evaluation.md` に失敗例1件以上 |
| 14 | モバイルで主要操作ができる | 実機で E2E シナリオを手動実行 |
| 15 | 90秒で説明できる | 声に出して計測 |
| 16 | 5分でデモできる | 実演して計測 |

---

## 19. 元計画からの変更点まとめ

| 箇所 | 変更 | 理由 |
|---|---|---|
| データ設計 | `student_viewers` 表を追加 | 学生アカウントと架空学生の対応関係を解決できなかったため |
| データ設計 | `generation_runs` に `tutor_id` / `prompt_version` を追加 | レート制限と評価の再現性のため |
| データ設計 | CHECK 制約を追加 | 「Approved なら中身がある」をアプリ任せにしないため |
| 権限管理 | RLS を明示的に採用 | v1.0 は方針のみ。実装方式を確定させた |
| AI 連携 | 構造化出力（JSON Schema）を採用 | v1.0 の「構造化出力に対応する LLM API」を具体化 |
| AI 連携 | 検証を二段構え（Zod + 要求一致）にした | スキーマ適合だけでは要求を満たさない場合があるため |
| 画面 | 承認ボタンをチェックリスト連動で無効化 | 製品原則を UI で強制するため |
| CI | Integration/E2E を CI から外した | 構築コストが期間に見合わない。README に明記する前提 |
| Day 6 | 進捗表示を「数値のみ」に縮小 | グラフは P1。MVP 確定を優先 |

---

## 20. 開発スレッドへの引き継ぎ文

新しい実装スレッドに本書と v1.0 を添付し、以下を送る。

```text
添付の2文書（v1.0 計画 / v2.0 詳細計画）に従って TutorFlow AI を開発したいです。

背景:
- 2024年8月から DVC の Engineering 専攻に在籍
- 2026年7〜8月に DVC 内部で数学チューターとして勤務
- 2026年秋に日本へ帰国し、東京都内で未経験 IT 就職を目指す
- 生成AIを活用して開発するが、生成コードを理解・検証できる形にしたい

守ってほしいこと:
1. 詳細計画 §13 のチケット順に進め、勝手に順序を変えない
2. 1チケットごとに実装 → 動作確認 → 私への説明、を1サイクルとする
3. 実体験と仮説を混同しない（詳細計画 §0.2 参照）
4. P0 を最優先し、勝手に機能を増やさない
5. 各チケットで、私が面接で説明すべき技術的判断（§16）を教える
6. lint / typecheck / test を継続して実行する
7. 実在学生の情報や DVC の公式ロゴを使わない
8. AI APIキーをコードや Git に入れない
9. Day 5 で公開可能な MVP を完成させる
10. AI_USAGE.md と DEVLOG.md を毎日更新する

まず D1-1 から始めてください。
```
