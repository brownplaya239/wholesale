import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { breakdown, callerQa, funnel, qaAverage, qaFlags, weeklySample, type Funnel } from "@/lib/acq/metrics";
import { contactUrl } from "@/lib/acq/processor";
import { recentCalls, type CallRow } from "@/lib/acq/store";

export const metadata: Metadata = { title: "Calls" };
export const dynamic = "force-dynamic";

const et = (v: string | null) =>
  v ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "short", timeStyle: "short" }).format(new Date(v)) : "—";
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

function FunnelRow({ label, f }: { label: string; f: Funnel }) {
  return (
    <tr className="border-t border-line text-center">
      <td className="py-1 pr-2 text-left">{label}</td>
      <td>{f.dials}</td>
      <td>{f.conversations}</td>
      <td>{pct(f.contactRate)}</td>
      <td>{f.qualified}</td>
      <td>{pct(f.qualificationRate)}</td>
      <td>{f.booked}</td>
      <td>{f.dnc}</td>
      <td className={f.violations ? "font-bold text-red-700" : ""}>{f.violations}</td>
    </tr>
  );
}

function FunnelTable({ title, rows }: { title: string; rows: { key: string; f: Funnel }[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-white p-4">
      <h3 className="font-bold">{title}</h3>
      <table className="mt-2 w-full min-w-[560px] text-sm">
        <thead className="text-xs text-ink-soft">
          <tr>
            <th className="py-1 text-left"></th>
            <th>Dials</th>
            <th>Convos</th>
            <th>Contact</th>
            <th>Qualified</th>
            <th>Qual. rate</th>
            <th>Booked</th>
            <th>DNC</th>
            <th>Violations</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <FunnelRow key={r.key} label={r.key} f={r.f} />
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={9} className="py-3 text-center text-ink-soft">
                No calls yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CallLink({ c }: { c: CallRow }) {
  return c.contactId ? (
    <a href={contactUrl(c.contactId)} className="underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
      {c.phone ?? c.id.slice(0, 8)}
    </a>
  ) : (
    <span>{c.phone ?? c.id.slice(0, 8)}</span>
  );
}

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const days = Math.min(Math.max(Number(sp.days) || 7, 1), 90);
  const db = await getDb();
  if (!db) return <p className="rounded-2xl border border-line bg-white p-6">Database not connected.</p>;
  const [calls, month] = await Promise.all([recentCalls(db, days, 5000), recentCalls(db, 30, 20000)]);
  const total = funnel(calls);
  const m30 = funnel(month);
  const violations = calls.filter((c) => c.flags.some((f) => f.severity === "violation"));
  const flagged = calls.filter((c) => qaFlags(c).length);
  const sample = weeklySample(calls);
  const qa = callerQa(calls);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Calls · last {days} days</h1>
        <div className="flex gap-2 text-sm">
          {[1, 7, 30, 90].map((d) => (
            <Link key={d} href={`/admin/calls?days=${d}`} className={`rounded-lg border px-2 py-1 ${d === days ? "border-ink font-bold" : "border-line"}`}>
              {d}d
            </Link>
          ))}
          <a href="/api/admin/acq/export?kind=calls" className="rounded-lg border border-line px-2 py-1">
            Dial log CSV
          </a>
          <a href="/api/admin/acq/export?kind=dnc" className="rounded-lg border border-line px-2 py-1">
            Internal DNC CSV
          </a>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Dials", total.dials],
          ["Owner conversations", `${total.conversations} (${pct(total.contactRate)})`],
          ["Qualified", `${total.qualified} (${pct(total.qualificationRate)})`],
          ["Booked", `${total.booked} (${pct(total.bookingRate)} of qualified)`],
          ["Compliance violations", total.violations],
          ["Dropped connects, 30d", `${m30.possibleAbandoned} (${pct(m30.abandonRate)} — cap 3%)`],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-2xl border border-line bg-white p-3">
            <div className="text-xs text-ink-soft">{k}</div>
            <div className="text-lg font-bold">{v}</div>
          </div>
        ))}
      </section>

      {violations.length > 0 && (
        <section className="rounded-2xl border border-red-300 bg-red-50 p-4">
          <h2 className="font-bold text-red-800">Compliance violations</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {violations.slice(0, 50).map((c) => (
              <li key={c.id}>
                {et(c.startedAt)} · <CallLink c={c} /> · caller {c.userId ?? "?"} ·{" "}
                {c.flags
                  .filter((f) => f.severity === "violation")
                  .map((f) => `${f.code}: ${f.detail}`)
                  .join("; ")}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <FunnelTable title="By caller" rows={breakdown(calls, "caller")} />
        <FunnelTable title="By county" rows={breakdown(calls, "county")} />
        <FunnelTable title="By list (cohort)" rows={breakdown(calls, "cohort")} />
        <FunnelTable title="By asset / source" rows={breakdown(calls, "asset").concat(breakdown(calls, "source"))} />
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="font-bold">Caller QA (AI review of recorded conversations)</h2>
        <table className="mt-2 w-full text-sm">
          <thead className="text-xs text-ink-soft">
            <tr>
              <th className="py-1 text-left">Caller</th>
              <th>Reviewed</th>
              <th>Avg QA (1-5)</th>
              <th>Flagged calls</th>
              <th>Disclosure misses</th>
            </tr>
          </thead>
          <tbody>
            {qa.map((q) => (
              <tr key={q.caller} className="border-t border-line text-center">
                <td className="py-1 text-left">{q.caller}</td>
                <td>{q.reviewed}</td>
                <td>{q.avg == null ? "—" : q.avg.toFixed(2)}</td>
                <td>{q.flags}</td>
                <td className={q.disclosureMisses ? "font-bold text-red-700" : ""}>{q.disclosureMisses}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3 className="mt-4 font-semibold">This period&apos;s listen-list (2 successful · 2 ordinary · 1 weak per caller)</h3>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {Object.entries(sample).map(([caller, s]) => (
            <div key={caller} className="rounded-xl border border-line p-3 text-sm">
              <div className="font-semibold">{caller}</div>
              {(["successful", "ordinary", "weak"] as const).map((k) => (
                <div key={k} className="mt-1">
                  <span className="text-xs uppercase text-ink-soft">{k}:</span>{" "}
                  {s[k].length
                    ? s[k].map((c) => (
                        <span key={c.id} className="mr-2">
                          <CallLink c={c} /> ({c.disposition ?? "?"}, QA {qaAverage(c)?.toFixed(1) ?? "—"})
                        </span>
                      ))
                    : "—"}
                </div>
              ))}
            </div>
          ))}
          {!Object.keys(sample).length && <p className="text-ink-soft">No recorded conversations yet.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="font-bold">AI review flags ({flagged.length})</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {flagged.slice(0, 100).map((c) => (
            <li key={c.id}>
              {et(c.startedAt)} · <CallLink c={c} /> · {c.disposition ?? "?"} · caller {c.userId ?? "?"} — {qaFlags(c).join(" | ")}
            </li>
          ))}
          {!flagged.length && <li className="text-ink-soft">Nothing flagged.</li>}
        </ul>
      </section>

      <section className="overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-line bg-cream text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-3 py-2">Started (ET)</th>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Caller</th>
              <th className="px-3 py-2">Talk</th>
              <th className="px-3 py-2">Disposition</th>
              <th className="px-3 py-2">County / list</th>
              <th className="px-3 py-2">AI</th>
              <th className="px-3 py-2">Pipeline</th>
            </tr>
          </thead>
          <tbody>
            {calls.slice(0, 200).map((c) => (
              <tr key={c.id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-3 py-2 text-ink-soft">{et(c.startedAt)}</td>
                <td className="px-3 py-2">
                  <CallLink c={c} />
                </td>
                <td className="px-3 py-2">{c.userId ?? "—"}</td>
                <td className="px-3 py-2">{c.seconds ?? 0}s</td>
                <td className="px-3 py-2">{c.disposition ?? c.outcome ?? "—"}</td>
                <td className="px-3 py-2 text-xs">
                  {c.dims.county || "—"} · {c.dims.cohort || "—"}
                </td>
                <td className="px-3 py-2 text-xs">{c.intel ? String((c.intel as { lead_temperature?: string }).lead_temperature ?? "") : c.intelStatus ?? c.transcriptStatus}</td>
                <td className="px-3 py-2 text-xs">{c.endedStatus}{c.endedError ? ` — ${c.endedError.slice(0, 60)}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
