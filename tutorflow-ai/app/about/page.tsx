import Link from "next/link";

const steps = [
  ["1", "Record", "理解度と次回目標を構造化して記録。"],
  ["2", "Draft", "AIは個人情報を受け取らず、指定条件の教材案を生成。"],
  ["3", "Verify", "人が検算した教材だけが授業に紐づく。"],
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#f4f6f3] px-6 py-10 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <Link className="text-sm font-semibold text-brand" href="/">TutorFlow AI</Link>
        <header className="max-w-3xl py-16">
          <p className="text-sm font-semibold uppercase tracking-[0.15em] text-accent">About the system</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">AIに任せること、人が決めること。</h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">TutorFlow AIはチューター本人の授業準備ツールです。AIは問題案を構造化して返しますが、正しさの最終判断は人が行います。</p>
        </header>
        <section className="grid gap-5 md:grid-cols-3">
          {steps.map(([number, title, body]) => (
            <article className="rounded-2xl border border-slate-200 bg-white p-6" key={number}>
              <p className="text-sm font-semibold text-accent">0{number}</p>
              <h2 className="mt-3 text-xl font-semibold">{title}</h2>
              <p className="mt-2 leading-7 text-slate-600">{body}</p>
            </article>
          ))}
        </section>
        <section className="mt-10 rounded-3xl bg-[#173f35] p-7 text-white sm:p-10">
          <h2 className="text-2xl font-semibold">Core architecture</h2>
          <div className="mt-6 grid gap-3 text-center sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <div className="rounded-xl bg-white/10 p-4">Next.js<br /><span className="text-sm text-white/70">UI + server actions</span></div>
            <span className="self-center">→</span>
            <div className="rounded-xl bg-white/10 p-4">Supabase<br /><span className="text-sm text-white/70">Auth + RLS + CHECK</span></div>
            <span className="self-center">→</span>
            <div className="rounded-xl bg-white/10 p-4">OpenAI<br /><span className="text-sm text-white/70">Structured draft only</span></div>
          </div>
        </section>
        <section className="py-14">
          <h2 className="text-2xl font-semibold">Known constraints</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-slate-600">
            <li>学生用ログインや外部共有はありません。</li>
            <li>実運用は alias のみで、実名や学籍情報を保存しません。</li>
            <li>AIの出力は正確性を保証しません。</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
