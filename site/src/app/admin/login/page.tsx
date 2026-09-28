import type { Metadata } from "next";
import { adminConfigured, safeNext } from "@/lib/admin/auth";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminLogin({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const configured = adminConfigured();
  return (
    <main className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-white p-6 shadow-sm">
        <p className="text-lg font-extrabold tracking-tight">
          House<span className="text-accent">Sold</span>NJ · Leads
        </p>
        <p className="mt-1 text-sm text-ink-soft">Internal lead reports. Authorized use only.</p>
        {configured ? (
          <form method="post" action="/api/admin/login" className="mt-5 space-y-3">
            <input type="hidden" name="next" value={safeNext(sp.next)} />
            <label className="block text-sm font-semibold" htmlFor="pw">
              Password
            </label>
            <input
              id="pw"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              className="w-full rounded-lg border border-line px-4 py-3 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            {sp.error && <p className="text-sm text-red-700">That password isn't right.</p>}
            <button className="w-full rounded-lg bg-ink px-4 py-3 font-bold text-white">Sign in</button>
          </form>
        ) : (
          <p className="mt-5 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            Admin access isn't configured yet. Add an <code>ADMIN_PASSWORD</code> environment
            variable in Vercel and redeploy.
          </p>
        )}
      </div>
    </main>
  );
}
