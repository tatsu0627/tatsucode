# TutorFlow AI 詳細開発計画 v4.0（Drop-in 診断ツール版）

**版:** 4.0
**作成日:** 2026年8月4日
**位置づけ:** v3.0 の実装（commit `652bf8a`）を**改修**する差分計画。ゼロからの再実装ではない
**前提資料:** `development-plan-v3.md`（§3 技術構成、§6 環境変数、§7.1 Supabase クライアント、§9 AI 連携の実装注意は**そのまま有効**）

---

## 0. 方針転換の理由と範囲

### 0.1 なぜ変えるか

v3.0 は塾・家庭教師モデルを前提にしていた。しかし DVC のチュータリングセンターは
drop-in であり、前提が成立しない。

| v3.0 の前提 | Drop-in の現実 |
|---|---|
| 同じ学生を継続担当する | 初対面が多く、次に会うか分からない |
| 次回目標を決めて教材を準備する | 誰が何を持って来るか事前に分からない |
| 理解度の推移を追う | 1回きりの学生には推移が存在しない |
| カリキュラムを自分が組む | 組むのは教授。学生は講義で詰まった箇所を持参する |

ループの起点だった `sessions.next_goal` が成立しない。**設計の土台が現実と
合っていない。**

### 0.2 実際の仕事は何か

1. 学生が「二次方程式が分からない」と来る
2. 実際に詰まっているのは2〜3段階下（符号、分数、分配法則）のことがある
3. それを短時間で見抜くのがチューターの技
4. 見抜いたら、その場でそのレベルの問題を出して確認する
5. 準備する時間はない

**「遡って原因を特定する」と「その場で問題を出す」**が仕事の中身。
v4.0 はこれを支える道具にする。

### 0.3 変更の範囲

**中規模。98ファイル中、触るのは30本程度。**

| 扱い | 対象 |
|---|---|
| **そのまま** | 認証・RLS・所有者スコープ／AI 構造化出力・要求一致検証／検算ゲート／セッションモード／UI 部品／テスト・CI・デプロイ構成 |
| **改修** | `materials`（列追加）／ホーム／ライブラリ／教材生成フォーム |
| **置換** | `sessions` → `consultations` |
| **新規** | `concepts` / `concept_edges` / `probes` の3表、診断画面、概念グラフ画面 |
| **廃止** | `sessions.next_goal`、理解度推移の画面、`/sessions/*` |

**Material Review 画面（`app/(app)/materials/[id]/page.tsx` と
`components/MaterialReview.tsx`）は一切変更しない。** v4.0 でも作品の中心。

---

## 1. 製品定義

### 1.1 一文

Drop-in のチュータリングで、学生が申告した内容と実際の詰まりどころのズレを、
前提知識をたどって特定するツール。各段階で出す確認問題は AI が下書きし、
**チューターが検算した問題しか学生に見せられない。**

### 1.2 使い方

```
学生「二次方程式が分からない」
        ↓
  申告された概念を選ぶ
        ↓
  アプリが次に確認すべき概念を1つ提示
   （前提をたどって、二分探索的に絞る）
        ↓
  その概念の【確認済み】プローブ問題を表示
   （なければ生成 → 検算 → 表示）
        ↓
  学生に解いてもらい、解けた/解けないを記録
        ↓
  絞り込み継続 ──→ 根本が特定された
        ↓
  そこの練習問題を出す／記録を残す
```

### 1.3 中核となる制約（v3 から継承・強化）

> **確認済みでない教材は、学生に提示した記録として残せない。**

v3 では「未確認教材はセッションに紐づけられない」だった。v4 では
**プローブ（学生の目の前で出す問題）が確認済み教材しか参照できない**に変わる。
学生に見せる問題なので、制約の意味が強くなる。

実装は複合外部キーで行う（§4.2）。**アプリのバリデーションではなく DB の構造で
保証する**方針は変えない。

### 1.4 作らないもの

学生用ログイン、外部共有、成績管理、自動採点、チャットボット、学校システム連携、
実在学生の個人情報管理、チューター間のグラフ共有（P2）。

---

## 2. 技術構成・環境変数・クライアント構成

**v3.0 §3 / §6 / §7.1 から変更なし。** 以下だけ再掲する。

- Next.js 15 App Router / TypeScript strict / Tailwind 4（CSS-first）
- Zod 4（`z.uuid()` 等のトップレベル形式 API）
- Supabase（`@supabase/ssr`、クライアント3分割）
- AI SDK は現行実装のまま（`AI_MODEL` 環境変数で切替）
- Vitest 3 / Playwright / GitHub Actions / Vercel

---

## 3. 概念グラフの設計

### 3.1 粒度の定義（最重要）

**1問出せば「解ける／解けない」が判定できる大きさ**をノードにする。

| 粒度 | 例 | 可否 |
|---|---|---|
| 粗すぎ | 「二次方程式」 | ✗ 1問で判定できない |
| 適切 | 「積が c、和が b になる2数を見つける」 | ✓ |
| 細かすぎ | 「6を2×3と分解する」 | ✗ グラフが書けない |

目安は**1科目あたり15〜25ノード、深さ3〜4**。

### 3.2 エッジの意味

`concept_edges(parent_id, child_id)` は
**「parent を理解するには child が必要」**を表す。

グラフは **DAG（閉路なし）** でなければならない。閉路があると診断が停止しない。
エッジ追加時に閉路検査を行う（§6.3）。

### 3.3 初期グラフ（Intermediate Algebra / Math 120 相当・18ノード）

`code` は英小文字とアンダースコアのみ。これを seed として投入する。

| # | code | 日本語ラベル |
|---|---|---|
| 1 | `signed_arithmetic` | 符号つき整数の四則 |
| 2 | `fraction_arithmetic` | 分数の四則 |
| 3 | `order_of_operations` | 演算の順序 |
| 4 | `exponent_rules` | 指数法則 |
| 5 | `distributive_law` | 分配法則で展開する |
| 6 | `combine_like_terms` | 同類項をまとめる |
| 7 | `linear_equation_one_var` | 一次方程式を解く |
| 8 | `factor_pair_search` | 積と和から2数を見つける |
| 9 | `gcf_factoring` | 共通因数でくくる |
| 10 | `factor_monic_trinomial` | x^2+bx+c の因数分解 |
| 11 | `factor_general_trinomial` | ax^2+bx+c の因数分解 |
| 12 | `difference_of_squares` | 平方の差 |
| 13 | `zero_product_property` | 零積の性質 |
| 14 | `solve_quadratic_by_factoring` | 因数分解で二次方程式を解く |
| 15 | `complete_the_square` | 平方完成 |
| 16 | `quadratic_formula` | 解の公式 |
| 17 | `rational_expression_simplify` | 有理式の約分 |
| 18 | `word_problem_to_equation` | 文章題を式にする |

**エッジ（parent ← child）:**

```
combine_like_terms           ← signed_arithmetic
distributive_law             ← signed_arithmetic
linear_equation_one_var      ← combine_like_terms, distributive_law, order_of_operations
factor_pair_search           ← signed_arithmetic
gcf_factoring                ← distributive_law
factor_monic_trinomial       ← factor_pair_search, distributive_law
factor_general_trinomial     ← factor_monic_trinomial, gcf_factoring
difference_of_squares        ← distributive_law, exponent_rules
solve_quadratic_by_factoring ← factor_monic_trinomial, zero_product_property
complete_the_square          ← distributive_law, exponent_rules, fraction_arithmetic
quadratic_formula            ← complete_the_square, signed_arithmetic
rational_expression_simplify ← gcf_factoring, factor_monic_trinomial, fraction_arithmetic
word_problem_to_equation     ← linear_equation_one_var
```

**このグラフは仮です。** 実務経験に基づいて本人が調整するため、画面から編集
できるようにする（§7.7）。

---

## 4. データベース設計

### 4.1 マイグレーション `0006_concepts.sql`

```sql
create type material_kind as enum ('probe', 'practice');
create type probe_result  as enum ('solved', 'failed', 'skipped');

-- 概念ノード
create table concepts (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references profiles(id) on delete cascade,
  code       text not null check (code ~ '^[a-z][a-z0-9_]{1,60}$'),
  label_ja   text not null check (char_length(label_ja) between 1 and 100),
  label_en   text not null check (char_length(label_en) between 1 and 100),
  course     text check (char_length(course) <= 50),
  created_at timestamptz not null default now(),
  unique (owner_id, code)
);
create index concepts_owner_idx on concepts (owner_id);

-- 前提関係: parent を理解するには child が必要
create table concept_edges (
  owner_id  uuid not null references profiles(id) on delete cascade,
  parent_id uuid not null references concepts(id) on delete cascade,
  child_id  uuid not null references concepts(id) on delete cascade,
  primary key (parent_id, child_id),
  constraint concept_edges_no_self_loop check (parent_id <> child_id)
);
create index concept_edges_child_idx on concept_edges (child_id);
create index concept_edges_owner_idx on concept_edges (owner_id);

-- 相談記録（v3 の sessions を置換。1回の来訪 = 1行）
create table consultations (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references profiles(id) on delete cascade,
  student_id            uuid references students(id) on delete set null,  -- drop-in は null
  consulted_at          date not null,
  course                text check (char_length(course) <= 50),
  reported_concept_id   uuid references concepts(id) on delete set null,
  identified_concept_id uuid references concepts(id) on delete set null,
  summary               text check (char_length(summary) <= 2000),
  private_notes         text check (char_length(private_notes) <= 2000),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index consultations_owner_date_idx  on consultations (owner_id, consulted_at desc);
create index consultations_identified_idx  on consultations (identified_concept_id);
```

**`student_id` が nullable なのが drop-in 対応の本体。** 名前を残さずに診断
だけ記録できる。

### 4.2 マイグレーション `0007_probes.sql` — **検算ゲートの中核**

```sql
-- materials に概念と種別を足す
alter table materials add column concept_id uuid references concepts(id) on delete set null;
alter table materials add column kind material_kind not null default 'practice';
create index materials_concept_kind_idx on materials (concept_id, kind, state);

-- 複合外部キーの参照先として (id, state) に一意制約を張る
alter table materials add constraint materials_id_state_key unique (id, state);

-- 学生に提示した問題の記録
create table probes (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references consultations(id) on delete cascade,
  concept_id      uuid not null references concepts(id) on delete cascade,
  material_id     uuid not null,
  material_state  material_state not null default 'verified',
  result          probe_result not null,
  step            smallint not null check (step between 1 and 20),
  created_at      timestamptz not null default now(),

  -- ★ 本アプリの中核制約 ★
  -- 参照先の教材は確認済みでなければならない
  constraint probes_material_must_be_verified check (material_state = 'verified'),
  constraint probes_material_fk foreign key (material_id, material_state)
    references materials (id, state) on update cascade,

  unique (consultation_id, step)
);
create index probes_consultation_idx on probes (consultation_id, step);
create index probes_concept_idx      on probes (concept_id);
```

**この2つの制約の組み合わせが v4.0 の主張である。**

- `probes.material_state` は既定値 `'verified'` で、CHECK により他の値を取れない
- 複合 FK `(material_id, material_state) → materials(id, state)` により、
  **参照先の materials 行の state が `verified` でなければ挿入できない**
- `on update cascade` により、教材の state を後から変えようとすると
  probes 側の CHECK に引っかかって**更新自体が拒否される**

つまり **「学生に見せた問題は、見せた時点で確認済みであり、後から確認済みでない
状態に戻すこともできない」**が、アプリのコードを1行も読まずに保証される。

### 4.3 マイグレーション `0008_drop_sessions.sql`

```sql
-- v3 の sessions を廃止する。materials.session_id も落とす
alter table materials drop constraint if exists materials_session_requires_verified;
alter table materials drop column if exists session_id;
drop table if exists sessions;
```

**適用前に既存データの移行が必要な場合は、先に手動で退避すること。**
実運用前なので通常は不要。

### 4.4 マイグレーション `0009_concepts_rls.sql`

```sql
alter table concepts      enable row level security;
alter table concept_edges enable row level security;
alter table consultations enable row level security;
alter table probes        enable row level security;

create policy concepts_owner_all on concepts
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy concept_edges_owner_all on concept_edges
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy consultations_owner_all on consultations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy probes_owner_all on probes
  for all using (
    exists (select 1 from consultations c
            where c.id = probes.consultation_id and c.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from consultations c
            where c.id = probes.consultation_id and c.owner_id = auth.uid())
  );
```

匿名ロール向けポリシーは**書かない**（デフォルト拒否を利用する v3 の方針を継承）。

### 4.5 デモデータの更新 `0010_demo_v4.sql`

`seed_demo_workspace` を書き換える。投入するもの:

- §3.3 の概念18ノードとエッジ（デモアカウント所有）
- 架空学生3名（v3 から流用、`students` はそのまま）
- 相談記録4件（うち2件は `student_id` を null にして drop-in を表現）
- 確認済みプローブ教材を5概念分（`kind='probe'`）
- 練習教材を `verified` 2件 / `unverified` 2件 / `discarded` 1件
- probes を1相談あたり2〜4件、`result` を混在させる
- `generation_runs` は**過去日時**で投入する（v3 の教訓。ここを外すとデモの
  レート制限が即発動する）

---

## 5. 診断アルゴリズム（作品の技術的な中心）

### 5.1 考え方

学生が申告した概念から前提をたどり、**「解ける層」と「解けない層」の境界**を
探す。境界のすぐ上が根本原因。

全ノードを試すのではなく、**深さの中央から試して二分探索的に絞る**。
20分のセッションで使うため、プローブ回数は3〜5回に収めたい。

### 5.2 純粋関数として実装する

DB に依存しない純関数にする。**これによりアルゴリズムを Unit テストで完全に
検証できる。** ファイルは `lib/diagnosis/engine.ts`。

```ts
export type ProbeStatus = "unknown" | "solved" | "failed";

export type ConceptGraph = {
  nodes: string[];                       // concept id の配列
  prerequisites: Map<string, string[]>;  // parent -> children（前提）
};

export type DiagnosisState = Map<string, ProbeStatus>;

/** 申告概念とその前提の推移閉包を候補集合として返す */
export function candidateSet(graph: ConceptGraph, reportedId: string): string[];

/** 申告概念からの最長距離。深いほど基礎的 */
export function depthMap(graph: ConceptGraph, reportedId: string): Map<string, number>;

/** 結果を適用し、推移的に伝播させた新しい状態を返す */
export function applyResult(
  graph: ConceptGraph, state: DiagnosisState,
  conceptId: string, result: "solved" | "failed" | "skipped",
): DiagnosisState;

/** 次に確認すべき概念。もう絞れないなら null */
export function nextProbe(
  graph: ConceptGraph, state: DiagnosisState, reportedId: string,
): string | null;

/** 根本原因。未確定なら null */
export function rootBlocker(
  graph: ConceptGraph, state: DiagnosisState, reportedId: string,
): string | null;
```

### 5.3 伝播規則

`applyResult` は次を適用する。**これが探索回数を減らす本体。**

| 結果 | 伝播 |
|---|---|
| `solved` | その概念の**前提すべて**を推移的に `solved` にする（因数分解ができるなら符号もできる） |
| `failed` | その概念に**依存する側**を推移的に `failed` にする（符号ができないなら因数分解もできない） |
| `skipped` | 伝播しない。そのノードだけ候補から外す |

### 5.4 `nextProbe` の選び方

1. 候補集合のうち `unknown` のものを取り出す
2. 空なら `null`
3. `depthMap` の中央値に最も近いノードを選ぶ
4. 同点なら `code` の辞書順で安定させる（テストの再現性のため）

### 5.5 `rootBlocker` の判定

次を満たす概念が根本原因。

- 状態が `failed`
- その概念の**直接の前提がすべて `solved`**（または前提を持たない）

複数該当する場合は最も深い（基礎的な）ものを返す。

### 5.6 停止条件

- `rootBlocker` が非 null → 特定完了
- `nextProbe` が null → 特定できず。画面には「申告された概念そのものが原因の
  可能性」と表示する

---

## 6. バリデーション層

### 6.1 v3 から変更なし

`lib/validation/ai-output.ts`（練習教材のスキーマ）と Unit テスト9件は**そのまま**。

### 6.2 新規 `lib/validation/probe-output.ts`

プローブ問題は形が違う。ヒントや解答手順は不要で、**正誤が明確に判定できること**
が要件。

```ts
import { z } from "zod";

export const probeDraftSchema = z.object({
  concept_code: z.string().min(1).max(60),
  question: z.string().min(5).max(500),
  expected_answer: z.string().min(1).max(200),
  answer_note: z.string().min(1).max(300),          // なぜその答えになるか1文
  common_wrong_answers: z.array(z.string().min(1).max(200)).min(1).max(3),
  review_warning: z.string().min(1),
});

export type ProbeDraft = z.infer<typeof probeDraftSchema>;
```

### 6.3 グラフの整合性 `lib/validation/graph.ts`

```ts
/** エッジを追加すると閉路ができるか */
export function wouldCreateCycle(
  graph: ConceptGraph, parentId: string, childId: string,
): boolean;
```

エッジ追加の Server Action で必ず呼ぶ。**閉路があると診断が停止しない**ため、
これはバリデーションではなく安全装置。

### 6.4 相談記録 `lib/validation/consultation.ts`

```ts
export const consultationInputSchema = z.object({
  studentId: z.uuid().nullable().default(null),      // drop-in は null
  consultedAt: z.iso.date(),
  course: z.string().trim().max(50).optional(),
  reportedConceptId: z.uuid().nullable().default(null),
  identifiedConceptId: z.uuid().nullable().default(null),
  summary: z.string().trim().max(2000).optional(),
  privateNotes: z.string().trim().max(2000).optional(),
});
```

---

## 7. 画面仕様

### 7.1 変更しない画面

**以下は一切触らない。**

- `/` Landing、`/login`、`/about`
- **`/materials/[id]` Material Review**（`MaterialReview.tsx`、`MaterialDiff.tsx`、
  `ProblemEditor.tsx`、`VerifyChecklist.tsx`）
- `/run/[materialId]` セッションモード（`SessionRunner.tsx`、`HintDisclosure.tsx`）

### 7.2 `/diagnose` — 診断フロー（新規・作品の中心）

**ステップ1: 申告内容の入力**

- 学生（任意・drop-in なら空欄のまま）
- コース（任意、`Math 120` など）
- **「学生が分からないと言っている概念」を選択**（検索可能なリスト）

**ステップ2〜: 絞り込み**

画面には次を表示する。

```
┌──────────────────────────────────────────────┐
│ 診断中  申告: 因数分解で二次方程式を解く       │
│ 確認済み 2 / 未確認 6                         │
├──────────────────────────────────────────────┤
│ 次に確認: 積と和から2数を見つける              │
│                                              │
│  [確認済みプローブあり]                        │
│  積が6、和が-5になる2つの整数は?               │
│                                              │
│  [ 解けた ]  [ 解けない ]  [ 飛ばす ]          │
├──────────────────────────────────────────────┤
│ これまでの結果                                 │
│  ✓ 分配法則で展開する      解けた              │
│  ✗ x^2+bx+c の因数分解     解けない            │
└──────────────────────────────────────────────┘
```

- 該当概念の**確認済みプローブ**があれば表示する
- なければ「プローブを生成する」ボタン。押すと生成 → **レビュー画面へ遷移**し、
  検算してから戻る（未確認のまま学生に出せない）
- 結果を押すと `applyResult` を適用し、次の概念へ

**ステップ最終: 特定完了**

```
┌──────────────────────────────────────────────┐
│ 根本原因: 符号つき整数の四則                    │
│ 申告内容から2段階下でした                       │
│                                              │
│  [ この概念の練習問題を出す ]                   │
│  [ 相談記録を保存する ]                         │
└──────────────────────────────────────────────┘
```

**受け入れ基準:**
- 未確認のプローブは学生表示領域に**絶対に出ない**
- ブラウザを閉じても診断の途中経過が残る（`consultations` と `probes` に都度保存）
- プローブ回数が5回を超えたら「絞り込みが進んでいません。グラフの見直しを検討
  してください」と表示する

### 7.3 `/consultations` / `/consultations/[id]`

- 一覧: 日付、コース、申告概念、特定された概念、学生（あれば）
- 詳細: 上記に加え、プローブの履歴（概念・結果・使った教材へのリンク）、
  まとめ、自分専用メモ
- **`identified_concept_id` 別の集計**を一覧上部に出す
  （「符号つき整数の四則: 5件」— 頻出の詰まりどころが見える）

**受け入れ基準:** 相談0件のとき「最初の診断を始める」導線が出る。

### 7.4 `/home` — 改修

表示するもの:
- **未確認の教材の件数**（強調。v3 から継承）
- 直近の相談5件
- **プローブが未整備の概念の件数**（確認済みプローブが0件の概念）
- デモアカウントならリセットボタン

「プローブが未整備の概念」が新しい行動導線。ここを埋めるほど診断が速くなる。

### 7.5 `/library` — 改修

- フィルタに **概念** と **種別（probe / practice）** を追加
- 既定は `確認済み` × `probe`（診断で使う在庫の確認が主目的になるため）
- 各行から「複製して再利用」「セッションモードで開く」（practice のみ）

### 7.6 `/materials/new` — 改修

- **概念を選択**する欄を追加（必須）
- **種別**を選択（probe / practice）
- probe を選ぶと問題数の欄は消え、常に1問になる
- practice のときは v3 のままの挙動

学習目標欄の自動入力元が `sessions.next_goal` → **選択した概念の `label_ja`**
に変わる。

### 7.7 `/concepts` — 概念グラフの編集（新規）

最小限でよい。凝った可視化は不要。

- ノード一覧（コース別、深さ順）
- ノードの追加・ラベル編集・削除
- エッジの追加・削除（親と子を選ぶだけ）
- **エッジ追加時に閉路検査**。閉路になるならエラー表示
- 各ノードに「確認済みプローブ 0件 / 2件」を表示

**受け入れ基準:** 閉路を作ろうとすると保存できず、理由が日本語で表示される。

### 7.8 廃止する画面

- `/sessions/new`、`/sessions/[id]/edit`
- `/students/[id]` の理解度推移セクション（学生詳細自体は残す）

---

## 8. AI 連携の改修

### 8.1 変更しない部分

**`lib/ai/generate.ts` の呼び出し方（`max_tokens`、拒否判定、切り詰め判定、
`parsed_output` の null チェック、エラー分類）は一切変更しない。**
v3.0 §9.2 の実装注意はそのまま有効。

### 8.2 プローブ用プロンプトの追加

`lib/ai/prompt.ts` に追加する。

```ts
export const PROBE_SYSTEM_PROMPT = `You are helping a mathematics tutor diagnose
where a student is actually stuck.

Produce ONE short diagnostic problem that tests EXACTLY the named skill and
nothing else. A student who has the skill should solve it in under a minute;
a student who lacks it should fail it. The tutor shows this to the student in
person, so it must be unambiguous.

Rules:
- Test exactly one skill. Do not require any other skill to solve it.
- Keep numbers small. The point is the skill, not arithmetic endurance.
- expected_answer must be a single unambiguous value or short expression.
- answer_note is one sentence explaining why that answer is correct.
- common_wrong_answers lists what a student who lacks this skill typically
  answers, so the tutor can recognise the failure mode immediately.
- Use plain-text math notation (x^2, sqrt(2), (a+b)/c). Do not use LaTeX.
- Never include names or any information about real people.
- Always set review_warning to: "AI-generated draft. Verify before showing a student."`;

export function buildProbePrompt(conceptCode: string, conceptLabelEn: string): string {
  return [
    `Skill code: ${conceptCode}`,
    `Skill: ${conceptLabelEn}`,
    ``,
    `Produce exactly one diagnostic problem for this skill.`,
  ].join("\n");
}
```

**個人情報を渡せない設計は維持する。** `buildProbePrompt` は概念のコードと
英語ラベルの2つしか受け取らない。学生情報を型として渡せない。

### 8.3 `generateProbeDraft` の追加

`lib/ai/generate.ts` に `generateMaterialDraft` と同じ構造で追加する。
違いはスキーマ（`probeDraftSchema`）とプロンプトだけ。

要求一致検証は `draft.concept_code === request.conceptCode` を確認する。

### 8.4 モックの追加

`lib/ai/mock.ts` に probe 用の fixture を追加。正常1件、異常2件
（`concept_code` 不一致、`common_wrong_answers` 空）。

---

## 9. API 契約

### 9.1 Route Handler

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/materials/generate` | 練習教材（v3 から変更なし。`conceptId` と `kind` を受け取るよう拡張） |
| POST | `/api/probes/generate` | プローブ生成（新規） |
| GET | `/api/health` | 変更なし |

エラー形式・レート制限・ログの4フィールド構成は v3 から変更しない。
**プローブ生成もレート制限の対象に含める。**

### 9.2 Server Actions

| Action | 検証 |
|---|---|
| `createConcept` / `updateConcept` / `deleteConcept` | code の形式、owner スコープ |
| `addConceptEdge` | **`wouldCreateCycle` が false であること** |
| `removeConceptEdge` | — |
| `startDiagnosis` | 申告概念が自分のものであること |
| `recordProbeResult` | **参照する教材が `verified` かつ `kind='probe'`** |
| `finishDiagnosis` | `identified_concept_id` を保存 |
| `createConsultation` / `updateConsultation` / `deleteConsultation` | `consultationInputSchema` |
| `verifyMaterial` / `discardMaterial` / `saveMaterialEdit` / `duplicateMaterial` | **v3 から変更なし** |
| `resetDemoData` | 変更なし |

---

## 10. テスト計画

### 10.1 Unit（既存22件 + 新規16件 = 38件）

**そのまま残す（22件）:** `ai-output.test.ts`(9)、`session-validation.test.ts`(7)
→ `consultation-validation.test.ts` にリネームして調整、`material-state.test.ts`(6)

**新規 `tests/unit/diagnosis-engine.test.ts`（10件）** — 作品の技術的中心

| ケース | 期待 |
|---|---|
| `candidateSet includes the reported concept and all prerequisites` | 推移閉包 |
| `candidateSet excludes unrelated concepts` | 無関係なノードを含まない |
| `depthMap assigns 0 to the reported concept` | 0 |
| `depthMap uses the longest path for diamond shapes` | 最長距離 |
| `solved propagates to all prerequisites` | 推移的に solved |
| `failed propagates to all dependents` | 推移的に failed |
| `skipped does not propagate` | 当該ノードのみ |
| `nextProbe picks a median-depth unknown concept` | 中央付近 |
| `nextProbe returns null when nothing is unknown` | null |
| `rootBlocker returns the deepest failed concept whose prerequisites are all solved` | 最深 |

**新規 `tests/unit/graph.test.ts`（3件）**

| ケース | 期待 |
|---|---|
| `wouldCreateCycle detects a direct back edge` | true |
| `wouldCreateCycle detects an indirect cycle` | true |
| `wouldCreateCycle allows a diamond` | false |

**新規 `tests/unit/probe-output.test.ts`（3件）**

| ケース | 期待 |
|---|---|
| `accepts a valid probe draft` | 成功 |
| `rejects an empty common_wrong_answers array` | 失敗 |
| `rejects a concept_code that does not match the request` | throw |

### 10.2 Integration（新規含め15件）

**`tests/integration/ownership.test.ts`（6件）** — v3 から変更なし

**`tests/integration/verification-gate.test.ts`（9件）** — 改修

| ケース | 期待 |
|---|---|
| **`db rejects a probe referencing an unverified material`** | **複合FK違反** |
| **`db rejects a probe referencing a discarded material`** | 複合FK違反 |
| **`db rejects un-verifying a material that a probe references`** | 更新拒否 |
| `db accepts a probe referencing a verified material` | 成功 |
| `db rejects verified state without verified_content` | 制約違反 |
| `verifying sets verified_at` | 非 null |
| `failed generation is recorded with success=false` | 1行増える |
| `demo rate limit blocks the 4th generation in an hour` | RateLimitError |
| `concept_edges rejects a self loop` | 制約違反 |

**上位3件が v4.0 の中核の証明。** 特に3件目（プローブが参照している教材は
確認済みから戻せない）は v3 にはなかった保証。

### 10.3 E2E（1本）

`tests/e2e/diagnose.spec.ts` — `MOCK_AI=1` で実行

```
1. デモでログイン
2. /diagnose を開き、申告概念に「因数分解で二次方程式を解く」を選ぶ
3. 提示された概念に確認済みプローブがないことを確認
4. 「プローブを生成する」→ レビュー画面へ遷移することを確認
5. チェックリスト未完で「確認済みにする」が無効であることを確認
6. 7項目チェック → 確認済みにする
7. 診断へ戻り、プローブが表示されることを確認
8. 「解けない」を記録 → 次の概念が提示される
9. 「解けた」を記録 → 根本原因が表示される
10. 相談記録を保存し、/consultations に出ることを確認
```

---

## 11. 作業分解（7日・38チケット）

v3 の実装を土台にした改修なので、ゼロからより短い。

### R1: グラフ基盤

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| R1-1 | `0006_concepts.sql` | 3表作成 | `feat: add concept graph schema` |
| R1-2 | `0009_concepts_rls.sql` の concepts / concept_edges 部分 | RLS 有効 | 同上 |
| R1-3 | `lib/db/types.ts` に4表と2 enum を手書き追加 | 型が通る | 同上 |
| R1-4 | `lib/validation/graph.ts`（`wouldCreateCycle`） | — | 同上 |
| R1-5 | `tests/unit/graph.test.ts` 3件 | 通過 | `test: cover graph cycle detection` |
| R1-6 | `/concepts` 画面（一覧・追加・編集・削除） | 操作できる | `feat: add concept graph editor` |
| R1-7 | エッジ追加・削除 Action（閉路検査つき） | 閉路で拒否 | 同上 |

### R2: 診断エンジン

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| R2-1 | `lib/diagnosis/engine.ts` の型と `candidateSet` | — | `feat: add diagnosis engine` |
| R2-2 | `depthMap` | — | 同上 |
| R2-3 | `applyResult`（3種の伝播規則） | — | 同上 |
| R2-4 | `nextProbe` | — | 同上 |
| R2-5 | `rootBlocker` | — | 同上 |
| R2-6 | `tests/unit/diagnosis-engine.test.ts` 10件 | 通過 | `test: cover diagnosis engine` |

**R2 は DB も UI も不要。純関数だけで完結する。最初に片付けること。**

### R3: 相談記録とプローブ

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| R3-1 | `0007_probes.sql`（**複合FK と CHECK**） | 適用可 | `feat: enforce verified-only probes in the schema` |
| R3-2 | `0008_drop_sessions.sql` | sessions 削除 | 同上 |
| R3-3 | `0009` の consultations / probes 部分 | RLS 有効 | 同上 |
| R3-4 | `lib/validation/consultation.ts` | — | `feat: replace sessions with consultations` |
| R3-5 | `/consultations` 一覧（概念別集計つき） | 表示 | 同上 |
| R3-6 | `/consultations/[id]` 詳細（プローブ履歴つき） | 表示 | 同上 |
| R3-7 | `/sessions/*` の削除と参照の除去 | ビルド通過 | 同上 |

### R4: AI プローブ生成

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| R4-1 | `lib/validation/probe-output.ts` | — | `feat: generate diagnostic probes` |
| R4-2 | `tests/unit/probe-output.test.ts` 3件 | 通過 | `test: cover probe output validation` |
| R4-3 | `PROBE_SYSTEM_PROMPT` と `buildProbePrompt` | — | `feat: generate diagnostic probes` |
| R4-4 | `generateProbeDraft`（既存構造を踏襲） | モックで生成可 | 同上 |
| R4-5 | probe 用モック fixture（正常1・異常2） | — | 同上 |
| R4-6 | `POST /api/probes/generate` | 未確認 probe が入る | 同上 |
| R4-7 | `/materials/new` に概念・種別を追加 | probe が作れる | 同上 |

### R5: 診断画面 — **中核**

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| R5-1 | `/diagnose` ステップ1（申告入力） | consultations に行ができる | `feat: add the diagnosis flow` |
| R5-2 | 絞り込み画面（次の概念・結果ボタン） | エンジンと接続 | 同上 |
| R5-3 | 確認済みプローブの表示 | 未確認は出ない | 同上 |
| R5-4 | 未整備時の「生成する」導線 → レビューへ | 遷移する | 同上 |
| R5-5 | `recordProbeResult` Action | probes に行ができる | 同上 |
| R5-6 | 根本原因の表示と練習問題への導線 | 表示 | 同上 |
| R5-7 | 途中経過の永続化（再訪で復元） | 復元できる | 同上 |
| R5-8 | プローブ5回超過時の警告 | 表示 | 同上 |

### R6: 既存画面の改修とデモデータ

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| R6-1 | `/home` 改修（未整備概念の件数を追加） | 表示 | `feat: rework home and library for concepts` |
| R6-2 | `/library` に概念・種別フィルタ | 絞れる | 同上 |
| R6-3 | `/students/[id]` から理解度推移を削除 | ビルド通過 | 同上 |
| R6-4 | `0010_demo_v4.sql`（**generation_runs は過去日時**） | 投入可 | `feat: update demo data for v4` |
| R6-5 | `/about` と `docs/architecture.md` の更新 | 図が v4 | `docs: update architecture for v4` |

### R7: 品質

| ID | 作業 | 完了条件 | コミット |
|---|---|---|---|
| R7-1 | Integration 15件を実装 | 収集できる | `test: cover the probe verification gate` |
| R7-2 | E2E `diagnose.spec.ts` | 実装完了 | 同上 |
| R7-3 | 全画面の空・失敗状態を確認 | 確認済み | `fix: handle empty and failure states` |
| R7-4 | `rg "sk-" .next` が0件 | 0件 | 同上 |
| R7-5 | ログの4フィールド維持を確認 | 確認済み | 同上 |

---

## 12. Definition of Done

| # | 条件 |
|---|---|
| 1 | 公開 URL がある |
| 2 | デモの入り方が明確 |
| 3 | 概念グラフを画面から編集でき、閉路を作れない |
| 4 | 申告概念から診断を開始でき、根本原因が表示される |
| 5 | **未確認のプローブが学生表示領域に出ない** |
| 6 | **プローブが確認済み教材しか参照できない（DB制約）** |
| 7 | **プローブが参照している教材を確認済みから戻せない（DB制約）** |
| 8 | デモアカウントからオーナーのデータが見えない |
| 9 | 実名・成績などを保存していない |
| 10 | API キーが公開されていない |
| 11 | lint / typecheck / test:unit（38件）が通る |
| 12 | Integration 15件が実 DB で通る |
| 13 | E2E が1本通る |
| 14 | README に背景・技術・構成・起動方法がある |
| 15 | `AI_USAGE.md` がある |
| 16 | AI 評価結果と失敗例がある |
| 17 | モバイルで主要操作ができる |
| 18 | **実務で1回以上、実際に診断に使った** |
| 19 | 90秒で説明できる |
| 20 | 5分でデモできる |

---

## 13. 面接で説明する技術的判断

| # | 判断 | 骨子 |
|---|---|---|
| 1 | 学生の申告を信じず、前提をたどって診断する | 「二次方程式が分からない」の原因が符号の扱いにあることは珍しくない。チューターが経験でやっていた遡りを構造にした |
| 2 | 確認済み教材しか参照できないことを複合外部キーで保証した | `(material_id, state)` の複合FKと CHECK の組み合わせ。アプリのコードを読まずに保証される |
| 3 | 参照済みの教材を未確認へ戻せないようにした | `on update cascade` が probes 側の CHECK を発火させる。学生に見せた記録の整合性を DB が守る |
| 4 | 診断エンジンを純関数にした | DB も UI も不要で全分岐を Unit テストできる。10ケースで伝播規則と探索を検証している |
| 5 | 深さの中央から探索する | 全ノードを試すと20分のセッションに収まらない。3〜5回で絞る設計 |
| 6 | 解けたら前提も解けたとみなす伝播 | 探索回数を実質的に減らす本体。因数分解ができるなら符号もできる |
| 7 | グラフの閉路を保存時に拒否した | 閉路があると診断が停止しない。バリデーションではなく安全装置 |
| 8 | プローブを事前生成・使い回しにした | その場で毎回生成すると待ち時間が発生し、検算の時間も取れない。在庫として持つ |
| 9 | AI 出力を JSON Schema で拘束し、要求一致も別途確認した | v3 から継承 |
| 10 | プロンプトに学生情報を渡せない関数シグネチャにした | v3 から継承。probe 用も概念コードと英語ラベルの2引数のみ |
| 11 | drop-in を前提に student_id を nullable にした | 継続担当を前提にした最初の設計が実務と合わず、作り直した |
| 12 | 設計を2回変えた理由を説明できる | 学生ポータル → チューター専用 → drop-in 診断。実務と噛み合わない前提を捨てた経緯 |

**12番は弱点ではなく強みとして話す。** 前提を検証して設計を捨てられることの証拠。

---

## 14. リスクと縮退ルール

| 時点 | 判定 | 縮退内容 |
|---|---|---|
| R2 終了 | 診断エンジンが書けない | 伝播規則を `solved` のみにし、`nextProbe` を「最深の unknown」に単純化する |
| R4 終了 | probe 生成が不安定 | probe を手書き登録できる画面を足し、AI 生成は practice のみにする |
| R5 終了 | 診断画面が未完 | R6 を捨てて R5 に充てる。ライブラリのフィルタとホームの改修を諦める |
| R6 終了 | 全体が未完 | `/concepts` の編集機能を読み取り専用にし、グラフは seed 固定にする |

**絶対に落とさないもの:** `0007_probes.sql` の複合FKと CHECK、診断エンジンの
Unit テスト、Material Review 画面、RLS。

---

## 15. 移行時の注意

1. **v3 の Material Review 画面には触らない。** レビュー済みで動作確認も
   済んでいる。`kind` による分岐を足す場合も、既存の練習教材の表示は変えない
2. **`lib/ai/generate.ts` の呼び出し方を変えない。** 実 SDK の型に対して検証済み
3. **`generation_runs` の seed は必ず過去日時にする。** v3 で一度踏んだ罠
4. **マイグレーションは 0006 → 0007 → 0008 → 0009 → 0010 の順**。0008 で
   sessions を落とすので、0007 より後に置くこと
5. `vitest.config.ts` の `server-only` スタブは維持する

---

## 16. 90秒の説明

```text
DVC のチュータリングセンターで数学チューターとして働いた経験から作りました。

センターは drop-in で、初対面の学生が講義で詰まった箇所を持って来ます。
このとき、学生が「二次方程式が分からない」と言っても、実際に詰まっているのは
2段階下の符号の扱いだった、ということが珍しくありません。それを短時間で
見抜くのがチューターの仕事の中心でした。

そこで、概念の前提関係をグラフとして持たせ、申告された内容から前提を
たどって根本原因を特定するツールを作りました。深さの中央から確認していく
ことで、3〜5問で絞り込めるようにしています。各段階の確認問題は AI が
その場で下書きしますが、学生の目の前で出すものなので、自分が検算して
確認済みにした問題しか表示されません。

これはアプリの制御ではなくデータベースの制約で保証しています。複合外部キーで
「確認済みの教材しか参照できない」を表現し、一度学生に見せた問題は後から
未確認の状態に戻すこともできません。

診断のアルゴリズムは純粋関数として切り出し、伝播規則と探索順序を10件の
ユニットテストで検証しています。
```
