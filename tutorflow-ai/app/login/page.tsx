import Link from "next/link";
import { demoLogin, login } from "./actions";

const messages: Record<string, string> = {
  invalid: "\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9\u307e\u305f\u306f\u30d1\u30b9\u30ef\u30fc\u30c9\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
  demo_unavailable: "\u73fe\u5728\u30c7\u30e2\u306b\u63a5\u7d9a\u3067\u304d\u307e\u305b\u3093\u3002\u6642\u9593\u3092\u304a\u3044\u3066\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-screen place-items-center bg-[#eef2ef] px-5 py-10">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-7 shadow-[0_25px_65px_rgba(23,63,53,0.12)] sm:p-9">
        <Link href="/" className="text-sm font-semibold text-brand">TutorFlow AI</Link>
        <h1 className="mt-8 text-3xl font-semibold tracking-tight">{"\u30c1\u30e5\u30fc\u30bf\u30fc\u30ed\u30b0\u30a4\u30f3"}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">{"\u6388\u696d\u8a18\u9332\u3068\u6559\u6750\u30ec\u30d3\u30e5\u30fc\u306b\u30a2\u30af\u30bb\u30b9\u3057\u307e\u3059\u3002"}</p>

        {error ? <p role="alert" className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{messages[error] ?? messages.invalid}</p> : null}

        <form action={login} className="mt-7 space-y-4">
          <label className="block text-sm font-medium" htmlFor="email">{"\u30e1\u30fc\u30eb\u30a2\u30c9\u30ec\u30b9"}</label>
          <input className="w-full rounded-xl border border-slate-300 px-4 py-3" id="email" name="email" type="email" autoComplete="email" required />
          <label className="block text-sm font-medium" htmlFor="password">{"\u30d1\u30b9\u30ef\u30fc\u30c9"}</label>
          <input className="w-full rounded-xl border border-slate-300 px-4 py-3" id="password" name="password" type="password" autoComplete="current-password" required />
          <button className="w-full rounded-xl bg-brand px-4 py-3 font-semibold text-white" type="submit">{"\u30ed\u30b0\u30a4\u30f3"}</button>
        </form>

        <div className="my-6 flex items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />or<span className="h-px flex-1 bg-slate-200" /></div>
        <form action={demoLogin}>
          <button className="w-full rounded-xl border border-brand px-4 py-3 font-semibold text-brand" type="submit">{"\u30c7\u30e2\u3092\u8a66\u3059"}</button>
          <p className="mt-2 text-center text-xs text-slate-500">{"\u67b6\u7a7a\u30c7\u30fc\u30bf\u3067\u5168\u6a5f\u80fd\u3092\u8a66\u305b\u307e\u3059"}</p>
        </form>
      </div>
    </main>
  );
}
