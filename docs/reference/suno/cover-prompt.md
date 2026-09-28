# Suno で弾き語り版を作る（Cover 機能）

原曲: `docs/reference/Olvdt08t96BUmpXo.mp4`
アップロード用の音声: `docs/reference/suno/source-audio.mp3`（4:22、192kbps、約6MB）

## 手順

1. Suno で **Create** を開き、音声のアップロード（Upload Audio）から `source-audio.mp3` を選ぶ
2. アップロードした曲で **Cover** を選ぶ
3. **Lyrics** 欄を下の「Lyrics」に置き換える（自動で読み込まれた歌詞より、区切りタグ付きのほうが構成が安定します）
4. **Style** 欄を下の「Style」に置き換え、**Exclude styles** があれば下の内容を入れる
5. 詳細設定（Advanced）は次を目安にする
   - **Audio Influence**（原曲をどれだけ残すか）: 中〜やや高め。メロディを残したいので上げ気味に。上げすぎると元のアレンジも残る
   - **Style Influence**: 高め
   - **Weirdness**: 低め
6. **Create**。1回で2曲できるので、良い方を選び、ダメなら Audio Influence を上下させて再生成

設定の名前や場所はアプリの更新で変わることがあります。上は 2026 年時点の解説記事をもとにしています。

## Style

```
Stripped-back acoustic singer-songwriter. Solo steel-string acoustic guitar and one lead voice only. Fingerpicked arpeggios in the verses, warm open strumming in the choruses, palm-muted build in the bridge, one sustained chord at a time for the quiet breakdown. Intimate close-mic vocal, gentle harmony only on the final chorus. Warm room reverb, natural dynamics, soft ending on a ringing Cmaj7. 117 BPM, C major.
```

## Exclude styles

```
drums, percussion, synth, electronic, bass drop, autotune, orchestra, strings, choir
```

## Lyrics

```
[Intro]
[Fingerpicked acoustic guitar]

[Verse 1]
I used to think that matrices were boring,
Just rows and columns, nothing more.
But then I saw what transformers were doing,
And now I'm pacing on the floor.
A bunch of weights, a bunch of multiplications,
Dot products stacking end to end.
And somehow out the other side comes language
That I can comprehend.

[Chorus]
I am actually scared of linear algebra.
It wasn't supposed to do all this.
A matrix multiply and activation—
Shouldn't feel this close to consciousness.

[Verse 2]
They told me it was just some math on paper,
But paper's where the proofs begin:
That any function can be approximated
By the architecture we put it in.
See, universal approximation told us,
With enough width you'll get it right.
Any continuous function on a compact set,
Just squeeze it till the loss is tight.
And what's a thought except a mapping,
Stimulus to response, input to out?
If everything the brain does is a function,
Then what is there to be smug about?

[Chorus]
I am actually scared of linear algebra.
It wasn't supposed to do all this.
A matrix multiply and activation
Shouldn't feel this close to consciousness.

[Bridge]
And don't you come at me with "it's just linear,"
Like that's a comfort, like that's safe.
Yeah, most of it is giant matrix multiplies,
But that's not even the whole case.
There's a ReLU waiting at every layer,
A softmax gating what gets through.
The nonlinearities are what break the ceiling.
Linear maps set the stage, but they're not the whole coup.

[Breakdown]
[Soft, sparse guitar]
One layer, linear; stack a few with kinks between.
Now you're carving up the space
Into regions, manifolds, decision boundaries,
A piecewise landscape no one can trace.
Your neurons fire in weighted combinations,
With threshold spikes and squashing curves.
That's dot products with nonlinear activations,
The same math everybody serves.

[Pre-Chorus]
So when they say "it's just predicting tokens,"
I hear "it's just predicting what comes next
In the space of every pattern ever spoken."
And honestly, I am a wreck.

[Final Chorus]
I am actually scared of linear algebra.
It scales. It generalizes. It lands.
A simple operation done a trillion times,
With nonlinear steps between the sands.
They say the brain is something more than matrices,
But no one's proved exactly what that is.
And until they do, I'm staring at the weight space,
Thinking, God, what if it's functions all the way down
And these are it.

[Outro]
[Quiet fingerpicking]
It's just matrix multiplication.
It's just matrix multiplication.
It's just matrix multiplication.
Then why does it talk back?

[End]
```

## うまくいかないとき

- **アップロードが拒否される:** Suno は既存の曲をチェックしていて、他人の曲だと判定されると Cover できないことがあります。その場合は、アップロードなしで Custom モードに Lyrics と Style を入れて新規生成する方法があります（メロディは原曲とは別物になります）
- **ドラムやシンセが入ってしまう:** Style の冒頭に `acoustic guitar and voice only` を足すか、Audio Influence を下げる
- **メロディが原曲から離れすぎる:** Audio Influence を上げる

## 権利について

原曲は他の人の作品です（Lyrics: Claude Opus 4.6 & Andy Masley / Music: Suno）。
Suno の規約（2026年9月3日施行）では、他のユーザーの曲をもとにしたリミックスは個人的・非商用の利用に限られます。
作ったものを公開・販売する場合は注意してください。
