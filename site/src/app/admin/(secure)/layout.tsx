import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: { default: "Leads", template: "%s · Leads" },
  robots: { index: false, follow: false },
};

/** Internal-report chrome. No analytics, no public nav. */
export default function SecureAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream print:bg-white">
      <header className="border-b border-line bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="text-lg font-extrabold tracking-tight">
            House<span className="text-accent">Sold</span>NJ · Leads
          </Link>
          <nav className="flex items-center gap-4 text-sm font-semibold" aria-label="Admin navigation">
            <Link href="/admin">Leads</Link>
            <Link href="/admin/driving-for-dollars">Driving for dollars</Link>
          </nav>
          <form method="post" action="/api/admin/logout">
            <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:border-ink-soft">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
