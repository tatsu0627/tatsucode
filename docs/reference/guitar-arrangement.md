# I Am Actually Scared of Linear Algebra — ギター弾き語りアレンジ

元動画: `docs/reference/Olvdt08t96BUmpXo.mp4`（4:22）
Lyrics: Claude Opus 4.6 & Andy Masley / Music: Suno / Video: Claude

- **Key:** C メジャー（カポなし。声に合わなければカポで調整）
- **Tempo:** 約 117 BPM、4/4
- **1行 = 2小節**（`|` で小節を区切り、1小節に2つあるコードは2拍ずつ）

> コードは音声の自動解析（librosa のクロマ解析）から起こしたもので、耳での確認はしていません。
> 大筋の進行は各セクションで繰り返し一致していますが、細部は実際に聴いて調整してください。

## 使うコード

`C` `Am` `F` `G` `Dm` `Em` `E7` `D7` `C7` `A7` `Fm`
スラッシュコード: `C/E` `C/G` `Am/G` `G/B`

- `F` が難しい場合は `Fmaj7`（x33210）で代用可
- `Fm` は Bridge の1か所だけ。セーハがきつければ `Fm`（xx3111）の4本押さえで
- `Am/G` は Am を押さえたまま6弦3フレット（または5弦をミュートして6弦開放で E を避ける）

## ストローク

- Verse: 8ビートを軽めに `↓ ↓↑ ↑↓↑`（または分散和音でアルペジオ）
- Chorus / Bridge: 同じパターンを強めに、4拍目裏のアクセントで推進力を出す
- Outro: 1小節1ストロークに落として、最後の一行は歌だけ残してもよい

---

## Intro（0:00–0:09）

```
| C | Am | F | G |
```

## Verse 1（0:10–0:40）

```
| C          | E7         |
  I used to think that matrices were boring,
| F    C     | Dm    G    |
  Just rows and columns, nothing more.
| Am   Em    | D7         |
  But then I saw what transformers were doing,
| F    C     | Dm    G    |
  And now I'm pacing on the floor.

| Am   C     | E7         |
  A bunch of weights, a bunch of multiplications,
| Am         | F    C     |
  Dot products stacking end to end.
| C    G/B   | D7   G     |
  And somehow out the other side comes language
| Dm   Am    | E7   G     |
  That I can comprehend.
```

## Chorus（0:40–1:00）

```
| C          | Am         |
  I am actually scared of linear algebra.
| F    C     | Dm    G    |
  It wasn't supposed to do all this.
| C    E7    | Am         |
  A matrix multiply and activation—
| F    C     | Em   Dm    | C    F     | C    G     |
  Shouldn't feel this close to consciousness.
```

## Verse 2（1:01–1:48）

```
| C          | C    E7    |
  They told me it was just some math on paper,
| Am         | C    C7    |
  But paper's where the proofs begin:
| F    Am    | A7   Dm    |
  That any function can be approximated
| D7         | C          |
  By the architecture we put it in.

| C          | C    E7    |
  See, universal approximation told us,
| F          | G          |
  With enough width you'll get it right.
| C          | E7         |
  Any continuous function on a compact set,
| Am   F     | C          |
  Just squeeze it till the loss is tight.

| F          | F    Dm    |
  And what's a thought except a mapping,
| C    Em/B  | Am         |
  Stimulus to response, input to out?
| F    Am    | E7   Dm    |
  If everything the brain does is a function,
| C          | G7         |
  Then what is there to be smug about?
```

※ 最後の小節（1:46–1:48）は原曲では少しひねった和音が鳴っています。`G7` で十分つながります。

## Chorus 2（1:48–2:05）

Chorus と同じ進行。

## Bridge A（2:06–2:37）

同じ8小節パターンを2回まわします。

```
| C          | E7         |
  And don't you come at me with "it's just linear,"
| Am         | Am/G  C7   |
  Like that's a comfort, like that's safe.
| F          | C/E   Am   |
  Yeah, most of it is giant matrix multiplies,
| D7         | C/G   G    |
  But that's not even the whole case.

| C          | E7         |
  There's a ReLU waiting at every layer,
| Am         | Am/G  C7   |
  A softmax gating what gets through.
| F          | C/E   Am   |
  The nonlinearities are what break the ceiling.
| D7         | C/G   G    |
  Linear maps set the stage, but they're not the whole coup.
```

## Bridge B（2:37–3:10）

```
| F          | Fm         |
  One layer, linear; stack a few with kinks between.
| C          | Am   C     |
  Now you're carving up the space
| F    Am    | C    Am    |
  Into regions, manifolds, decision boundaries,
| C    E7    | Dm    C    |
  A piecewise landscape no one can trace.

| G          | C          |
  Your neurons fire in weighted combinations,
| C          | C    G     | Am   G     |
  With threshold spikes and squashing curves.
| C          | C    E7    |
  That's dot products with nonlinear activations,
| F    Am    | C    G     |
  The same math everybody serves.
```

`F → Fm → C`（2:37–2:41）はこの曲でいちばん効く瞬間です。`Fm` はしっかり鳴らしてください。

## Bridge A'（3:11–3:25）

Bridge A と同じ進行（最後だけ `D7` → `Dm`）。

```
| C          | E7         |
  So when they say "it's just predicting tokens,"
| Am         | Am/G  C7   |
  I hear "it's just predicting what comes next
| F          | Am         |
  In the space of every pattern ever spoken."
| Dm         | C    G     |
  And honestly, I am a wreck.
```

## Final Chorus（3:26–3:59）

Chorus の進行を2回。

```
| C          | Am         |
  I am actually scared of linear algebra.
| F    C     | Dm    G    |
  It scales. It generalizes. It lands.
| C    E7    | Am         |
  A simple operation done a trillion times,
| F    Am    | C    G     |
  With nonlinear steps between the sands.

| C          | Am         |
  They say the brain is something more than matrices,
| F    C     | C    G     |
  But no one's proved exactly what that is.
| C    E7    | Am    C    |
  And until they do, I'm staring at the weight space,
| F    Am    | G    C     |
  Thinking, God, what if it's functions all the way down
  And these are it.
```

## Outro（4:01–4:16）

```
| F    Em    | C          |
  It's just matrix multiplication.
| F    Em    | C          |
  It's just matrix multiplication.
| F    G     | Am         |
  It's just matrix multiplication.
| C                       |
  Then why does it talk back?
```

終わり方の案: 最後の `C` を鳴らさずに `Am` のまま止めると、問いかけで終わる余韻が強くなります。
