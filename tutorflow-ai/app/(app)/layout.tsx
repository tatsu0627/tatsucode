import Link from "next/link";
import { requireProfile } from "@/lib/auth/guards";
import { logout } from "@/app/login/actions";

export const dynamic = "force-dynamic";

const links = [
  ["/home", "\u30db\u30fc\u30e0"],
  ["/students", "\u5b66\u751f"],
  ["/diagnose", "\u8a3a\u65ad"],
  ["/consultations", "\u76f8\u8ac7\u5c65\u6b74"],
  ["/concepts", "\u6982\u5ff5"],
  ["/materials/new", "\u6559\u6750\u3092\u4f5c\u308b"],
  ["/library", "\u30e9\u30a4\u30d6\u30e9\u30ea"],
] as const;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <div className="min-h-screen bg-[#f5f7f4]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4">
          <Link href="/home" className="mr-auto font-semibold tracking-tight text-brand">TutorFlow AI</Link>
          <nav aria-label="Main navigation" className="order-3 flex w-full gap-1 overflow-x-auto text-sm sm:order-none sm:w-auto">
            {links.map(([href, label]) => <Link className="whitespace-nowrap rounded-lg px-3 py-2 text-slate-600 hover:bg-brand-soft hover:text-brand" href={href} key={href}>{label}</Link>)}
          </nav>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-500 md:inline">{profile.display_name}{profile.is_demo ? " (Demo)" : ""}</span>
            <form action={logout}><button className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700">{"\u30ed\u30b0\u30a2\u30a6\u30c8"}</button></form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8">{children}</main>
    </div>
  );
}
