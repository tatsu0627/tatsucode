import Link from "next/link";

const copy = {
  login: "\u30ed\u30b0\u30a4\u30f3",
  eyebrow: "Human-verified learning materials",
  titleLead: "AI\u306e\u4e0b\u66f8\u304d\u3092\u3001",
  titleEnd: "\u6388\u696d\u3067\u4f7f\u3048\u308b\u6559\u6750\u3078\u3002",
  intro:
    "\u5b66\u7fd2\u8a18\u9332\u3068\u6b21\u56de\u76ee\u6a19\u3092\u3064\u306a\u304e\u3001\u7df4\u7fd2\u554f\u984c\u3092\u6e96\u5099\u3059\u308b\u6570\u5b66\u30c1\u30e5\u30fc\u30bf\u30fc\u5c02\u7528\u30c4\u30fc\u30eb\u3002AI\u304c\u4f5c\u3063\u305f\u554f\u984c\u306f\u3001\u672c\u4eba\u304c\u691c\u7b97\u3057\u3066\u78ba\u8a8d\u6e08\u307f\u306b\u3059\u308b\u307e\u3067\u6388\u696d\u8a18\u9332\u306b\u7d10\u3065\u304d\u307e\u305b\u3093\u3002",
  tryDemo: "\u67b6\u7a7a\u30c7\u30fc\u30bf\u3067\u8a66\u3059",
  seeDesign: "\u8a2d\u8a08\u3092\u898b\u308b",
  review: "\u6559\u6750\u30ec\u30d3\u30e5\u30fc",
  unverified: "\u672a\u78ba\u8a8d",
  warning: "AI\u751f\u6210\u306e\u4e0b\u66f8\u304d\u3067\u3059\u3002\u4f7f\u7528\u524d\u306b\u3059\u3079\u3066\u691c\u7b97\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
  checks: ["\u554f\u984c\u306f\u89e3\u3051\u308b\u304b", "\u89e3\u7b54\u306f\u6b63\u3057\u3044\u304b", "\u96e3\u6613\u5ea6\u306f\u5408\u3046\u304b"],
  disabled: "7\u9805\u76ee\u3092\u78ba\u8a8d\u3057\u3066\u304b\u3089\u78ba\u5b9a",
};

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-[#f4f6f3] text-slate-950">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Link href="/" className="font-semibold tracking-tight">TutorFlow AI</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/about" className="text-slate-600 hover:text-slate-950">About</Link>
          <Link className="rounded-full bg-[#173f35] px-5 py-2.5 font-medium text-white" href="/login">{copy.login}</Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-12 px-6 py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-28">
        <div>
          <p className="mb-6 text-sm font-semibold uppercase tracking-[0.18em] text-[#b85c2a]">{copy.eyebrow}</p>
          <h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] tracking-[-0.04em] sm:text-6xl">
            {copy.titleLead}<br />{copy.titleEnd}
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-600">{copy.intro}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link className="rounded-full bg-[#173f35] px-6 py-3 font-semibold text-white shadow-sm" href="/login">{copy.tryDemo}</Link>
            <Link className="rounded-full border border-slate-300 bg-white px-6 py-3 font-semibold text-slate-800" href="/about">{copy.seeDesign}</Link>
          </div>
        </div>

        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(23,63,53,0.12)]">
          <div className="flex items-center justify-between border-b border-slate-100 pb-5">
            <div><p className="text-sm text-slate-500">{copy.review}</p><p className="mt-1 font-semibold">Quadratic equations</p></div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">{copy.unverified}</span>
          </div>
          <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-950">{copy.warning}</div>
          <div className="mt-5 space-y-3">
            {copy.checks.map((item, index) => (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3" key={item}>
                <span className={`grid size-5 place-items-center rounded-md border ${index < 2 ? "border-[#286d5b] bg-[#286d5b] text-white" : "border-slate-300"}`}>{index < 2 ? "\u2713" : ""}</span>
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>
          <button className="mt-5 w-full rounded-xl bg-slate-200 px-4 py-3 font-semibold text-slate-500" disabled>{copy.disabled}</button>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-12 md:grid-cols-3">
          {[
            ["01", "\u8a18\u9332", "\u5b66\u751f\u3054\u3068\u306e\u7406\u89e3\u5ea6\u3001\u3064\u307e\u305a\u304d\u3001\u6b21\u56de\u76ee\u6a19\u3092\u77ed\u304f\u6b8b\u3059\u3002"],
            ["02", "\u4e0b\u66f8\u304d", "\u6b21\u56de\u76ee\u6a19\u3092\u3082\u3068\u306b\u3001AI\u304c\u554f\u984c\u30fb\u30d2\u30f3\u30c8\u30fb\u89e3\u7b54\u6848\u3092\u4f5c\u308b\u3002"],
            ["03", "\u691c\u7b97", "7\u9805\u76ee\u3092\u78ba\u8a8d\u3057\u3001\u672c\u4eba\u304c\u78ba\u5b9a\u3057\u305f\u6559\u6750\u3060\u3051\u3092\u6388\u696d\u3067\u4f7f\u3046\u3002"],
          ].map(([number, title, body]) => (
            <article key={number}><p className="text-sm font-semibold text-[#b85c2a]">{number}</p><h2 className="mt-2 text-xl font-semibold">{title}</h2><p className="mt-2 leading-7 text-slate-600">{body}</p></article>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-sm leading-6 text-slate-500">
        <p>This is a personal tool and portfolio project, not an official DVC product.</p>
        <p>All data in the public demo is fictional.</p>
      </footer>
    </main>
  );
}
