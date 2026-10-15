import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { formatIntel, type CallIntel } from "@/lib/acq/callIntel";
import { callerNamer } from "@/lib/acq/digest";
import { qaAverage, qaFlags } from "@/lib/acq/metrics";
import { contactUrl } from "@/lib/acq/processor";
import { getCall } from "@/lib/acq/store";

export const metadata: Metadata = { title: "Call" };
export const dynamic = "force-dynamic";

const et = (v: string | null) =>
  v ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(v)) : "—";

/** One call: who, outcome, flags, the AI review and the full transcript. Linked from Slack reports and the AI note in GHL. */
export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getDb();
  if (!db) return <p className="rounded-2xl border border-line bg-white p-6">Database not connected.</p>;
  const c = await getCall(db, decodeURIComponent(id));
  if (!c) notFound();
  const intel = c.intel as (CallIntel & { model?: string }) | null;
  const flags = qaFlags(c);
  const qa = qaAverage(c);
  const name = c.dims.name || c.phone || c.id;

  return (
    <div className="grid gap-4">
      <Link href="/admin/calls" className="text-sm text-ink-soft hover:text-ink">
        ← Calls
      </Link>
      <div className="rounded-2xl border border-line bg-white p-5">
        <h1 className="text-xl font-extrabold">{name}</h1>
        <p className="text-sm text-ink-soft">{c.dims.property || "—"}</p>
        <p className="mt-2 text-sm">
          {et(c.startedAt)} · {c.seconds ?? 0}s · {callerNamer()(c.userId)} · <b>{c.disposition ?? c.dispositionKey ?? "no disposition"}</b>
          {qa != null && <> · AI QA {qa.toFixed(1)}/5</>}
          {c.contactId && (
            <>
              {" "}
              ·{" "}
              <a href={contactUrl(c.contactId)} target="_blank" rel="noreferrer" className="underline">
                open in GHL
              </a>
            </>
          )}
        </p>
        {c.note && <p className="mt-2 text-sm">Caller note: {c.note}</p>}
      </div>

      {(c.flags.length > 0 || flags.length > 0) && (
        <div className="rounded-2xl border border-red-200 bg-white p-5 text-sm">
          <h2 className="font-bold">Flags</h2>
          <ul className="mt-2 list-disc pl-5">
            {c.flags.map((f, i) => (
              <li key={`f${i}`} className={f.severity === "violation" ? "font-bold text-red-700" : ""}>
                {f.code}: {f.detail}
              </li>
            ))}
            {flags.map((f, i) => (
              <li key={`q${i}`}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-white p-5 text-sm">
        <h2 className="font-bold">AI review</h2>
        {intel ? (
          <>
            <p className="mt-2">{intel.summary}</p>
            <pre className="mt-3 whitespace-pre-wrap font-sans">{formatIntel(intel)}</pre>
            {intel.qa?.coaching_note && <p className="mt-3"><b>Coaching:</b> {intel.qa.coaching_note}</p>}
          </>
        ) : (
          <p className="mt-2 text-ink-soft">Not reviewed ({c.intelStatus ?? "pending"}{c.intelError ? ` — ${c.intelError}` : ""}).</p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-white p-5 text-sm">
        <h2 className="font-bold">Transcript</h2>
        {c.wavvSummary && <p className="mt-2 text-ink-soft">WAVV summary: {c.wavvSummary}</p>}
        {c.transcript ? (
          <pre className="mt-3 whitespace-pre-wrap font-sans leading-relaxed">{c.transcript}</pre>
        ) : (
          <p className="mt-2 text-ink-soft">
            No transcript ({c.recorded ? `recording found, transcript ${c.transcriptStatus}` : "call not recorded"}).
          </p>
        )}
      </div>
    </div>
  );
}
