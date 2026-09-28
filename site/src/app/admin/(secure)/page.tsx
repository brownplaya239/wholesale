import type { Metadata } from "next";
import Link from "next/link";
import { campaignFunnel, recentIngests, usageLast7 } from "@/lib/admin/data";
import { getDb } from "@/lib/db";
import { mlsFeeds } from "@/lib/enrich/mls";
import { STATUS_LABEL } from "@/lib/leads/pipeline";
import { describeSource, type LeadSource } from "@/lib/leads/source";
import { listLeads } from "@/lib/leads/store";
import { salesFreshness } from "@/lib/sr1a";

export const metadata: Metadata = { title: "All leads" };
export const dynamic = "force-dynamic";

const et = (v: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(v));
const money = (n: number) => `$${Math.round(n / 1000)}k`;

const ENRICH_BADGE: Record<string, string> = {
  complete: "bg-green-100 text-green-800",
  partial: "bg-amber-100 text-amber-900",
  running: "bg-blue-100 text-blue-800",
  pending: "bg-gray-100 text-gray-700",
  failed: "bg-red-100 text-red-800",
};

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ ingest?: string; mls?: string }> }) {
  const sp = await searchParams;
  const db = await getDb();
  if (!db) {
    return (
      <div className="rounded-2xl border border-line bg-white p-6">
        <h1 className="text-xl font-bold">Lead database not connected</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Leads are still being emailed. To store them and generate property reports, connect a Postgres
          database (Vercel → Storage → Neon) so <code>DATABASE_URL</code> is set, then redeploy.
        </p>
      </div>
    );
  }
  const [leads, usage, ingests, fresh, funnel] = await Promise.all([
    listLeads(db, 200),
    usageLast7(db),
    recentIngests(db),
    salesFreshness(db),
    campaignFunnel(db),
  ]);
  const y = new Date().getFullYear();
  const feeds = mlsFeeds();

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-2xl font-extrabold tracking-tight">Leads</h1>
          <p className="text-sm text-ink-soft">{leads.length} most recent</p>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-cream text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2">Received (ET)</th>
                <th className="px-3 py-2">Seller</th>
                <th className="px-3 py-2">Property</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Report</th>
                <th className="px-3 py-2">Prelim. value</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-0 hover:bg-cream/60">
                  <td className="whitespace-nowrap px-3 py-2 text-ink-soft">{et(l.createdAt)}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/leads/${l.id}`} className="font-semibold text-ink underline-offset-2 hover:underline">
                      {l.name}
                    </Link>
                    <div className="text-xs text-ink-soft">{l.phone}</div>
                  </td>
                  <td className="px-3 py-2">
                    {l.addressCurrent}
                    {l.addressUnit && <span className="text-ink-soft"> · Unit {l.addressUnit}</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{describeSource(l.source as LeadSource)}</td>
                  <td className="px-3 py-2">{STATUS_LABEL[l.status as keyof typeof STATUS_LABEL] ?? l.status}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ENRICH_BADGE[l.enrichmentStatus] ?? ""}`}>
                      {l.enrichmentStatus}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {l.valuation ? (
                      <span>
                        {money(l.valuation.low)}–{money(l.valuation.high)}{" "}
                        <span className="text-xs text-ink-soft">({l.valuation.confidence})</span>
                      </span>
                    ) : (
                      <span className="text-ink-soft">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-ink-soft">
                    No leads stored yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line bg-white p-4">
          <h2 className="font-bold">Campaign funnel</h2>
          <p className="text-xs text-ink-soft">Lead → contacted → appointment → contract → closed, from the stage you set on each report.</p>
          <table className="mt-2 w-full text-sm">
            <thead className="text-xs text-ink-soft">
              <tr>
                <th className="py-1 text-left">Campaign</th>
                <th>Leads</th>
                <th>Contacted</th>
                <th>Appts</th>
                <th>Contracts</th>
                <th>Closed</th>
              </tr>
            </thead>
            <tbody>
              {funnel.map((f) => (
                <tr key={f.campaign} className="border-t border-line text-center">
                  <td className="py-1 text-left">{f.campaign}</td>
                  <td>{f.leads}</td>
                  <td>{f.contacted}</td>
                  <td>{f.appointments}</td>
                  <td>{f.contracts}</td>
                  <td>{f.closed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border border-line bg-white p-4">
          <h2 className="font-bold">Data sources</h2>
          <p className="mt-1 text-sm text-ink-soft">
            NJ deed sales (SR1A):{" "}
            {fresh ? (
              <>
                {fresh.files.join(", ")} · deeds recorded through <strong>{fresh.maxRecorded}</strong>
              </>
            ) : (
              <strong className="text-red-700">not loaded — comps are unavailable until you load them</strong>
            )}
          </p>
          <form method="post" action="/api/admin/ingest" className="mt-2 flex flex-wrap items-center gap-2 text-sm">
            <select name="year" defaultValue={y} className="rounded-lg border border-line px-2 py-1.5">
              {[y, y - 1, y - 2].map((yr) => (
                <option key={yr} value={yr}>
                  {yr === y ? `${yr} (year to date)` : yr}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-ink-soft">
              <input type="checkbox" name="force" value="1" /> re-load even if unchanged
            </label>
            <button className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-white">Load deed data</button>
          </form>
          {sp.ingest && <p className="mt-2 text-sm font-semibold text-trust">{sp.ingest}</p>}
          <ul className="mt-2 space-y-0.5 text-xs text-ink-soft">
            {ingests.map((r, i) => (
              <li key={i}>
                {r.at ? et(r.at) : ""} · {r.file} · {r.status}
                {r.inserted != null && ` · +${r.inserted.toLocaleString()} rows`}
                {r.error && <span className="text-red-700"> · {r.error}</span>}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-ink-soft">
            MLS (beds/baths, listing history, nearby listings):{" "}
            {feeds.length ? (
              <strong>{feeds.map((f) => f.name).join(", ")}</strong>
            ) : (
              <strong className="text-amber-800">not connected — set the MLS_MOMLS_* / MLS_CJMLS_* variables in Vercel</strong>
            )}
          </p>
          {feeds.length > 0 && (
            <form method="post" action="/api/admin/mls-test" className="mt-2">
              <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">Test MLS connection</button>
            </form>
          )}
          {sp.mls && <p className="mt-2 text-sm font-semibold text-trust">{sp.mls}</p>}
          <h3 className="mt-4 text-sm font-bold">API usage, last 7 days</h3>
          <table className="mt-1 w-full text-xs">
            <thead className="text-ink-soft">
              <tr>
                <th className="text-left">Provider</th>
                <th>Calls</th>
                <th>Errors</th>
                <th>Cache hits</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.provider} className="border-t border-line text-center">
                  <td className="py-0.5 text-left">{u.provider}</td>
                  <td>{u.calls}</td>
                  <td className={u.errors ? "font-semibold text-red-700" : ""}>{u.errors}</td>
                  <td>{u.cache_hits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
