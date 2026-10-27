import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { site } from "@/config/site";
import { getDb } from "@/lib/db";
import { assignWorkflow } from "@/lib/enrich/insights";
import type { MlsListing } from "@/lib/enrich/mls";
import { defaultWorksheet } from "@/lib/enrich/worksheet";
import { currentDossier, leadFacts } from "@/lib/leads/enrich";
import { imageUrl } from "@/lib/leads/images";
import { photoLines } from "@/lib/leads/reportEmail";
import type { Dossier, Fact, FactStatus, Section, SourceRef } from "@/lib/enrich/types";
import { LEAD_STATUSES, STATUS_LABEL } from "@/lib/leads/pipeline";
import { describeSource, type LeadSource } from "@/lib/leads/source";
import { getLead, listPhotoIds } from "@/lib/leads/store";
import StreetView from "./StreetView";
import Worksheet from "./Worksheet";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: `Lead ${id.slice(0, 8)}` };
}

const et = (v: string | null | undefined) =>
  v
    ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(v))
    : "—";
const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const num = (n: number | null | undefined, digits = 0) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });

const STATUS_TEXT: Record<FactStatus, string> = {
  ok: "",
  missing: "No record found",
  not_configured: "Not connected",
  not_available: "No NJ public source",
  error: "Source failed",
};

function asOf(s: SourceRef): string {
  if (!s.asOf) return "";
  return /^\d{4}-\d\d-\d\dT/.test(s.asOf) ? ` · data as of ${s.asOf.slice(0, 10)}` : ` · ${s.asOf}`;
}

function SourceTag({ source, status, note }: { source: SourceRef | null; status?: FactStatus; note?: string }) {
  if (status && status !== "ok") {
    return (
      <span className={`text-[11px] ${status === "error" ? "text-red-700" : "text-amber-800"}`}>
        {STATUS_TEXT[status]}
        {note ? ` — ${note}` : ""}
      </span>
    );
  }
  if (!source) return null;
  return (
    <span className="text-[11px] text-ink-soft">
      Source:{" "}
      {source.url ? (
        <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">
          {source.name}
        </a>
      ) : (
        source.name
      )}
      {asOf(source)}
    </span>
  );
}

function Card({ n, title, children, estimate }: { n: number; title: string; children: React.ReactNode; estimate?: boolean }) {
  return (
    <section
      className={`rounded-2xl border p-5 break-inside-avoid ${estimate ? "border-amber-300 bg-amber-50/40" : "border-line bg-white"}`}
    >
      <h2 className="flex items-baseline gap-2 text-lg font-bold">
        <span className="text-sm font-semibold text-ink-soft">{n}.</span>
        {title}
        {estimate && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-900">Estimate</span>}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function FactRow({ label, value, fact, source, status }: { label: string; value: React.ReactNode; fact?: Fact<unknown>; source?: SourceRef | null; status?: FactStatus }) {
  const st = fact?.status ?? status ?? "ok";
  const src = fact?.source ?? source ?? null;
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 border-b border-line py-1.5 last:border-0">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-sm">
        <span className="font-semibold">{st === "ok" ? value : "—"}</span>
        <div>
          <SourceTag source={src} status={st} note={fact?.note} />
        </div>
      </dd>
    </div>
  );
}

function SectionNote<T>({ s }: { s: Section<T> }) {
  if (s.status === "ok" && !s.note) return null;
  return (
    <p className={`mt-2 text-xs ${s.status === "error" ? "text-red-700" : "text-ink-soft"}`}>
      {s.status !== "ok" && <strong>{STATUS_TEXT[s.status]}. </strong>}
      {s.note}
      {s.error && ` (${s.error})`}
    </p>
  );
}

function ParcelShape({ rings }: { rings: [number, number][][] }) {
  const pts = rings.flat();
  if (pts.length < 3) return null;
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xy = (p: [number, number]) => [p[0] * k, -p[1]] as const;
  const all = pts.map(xy);
  const [minX, maxX] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const [minY, maxY] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const pad = span * 0.08;
  const d = rings
    .map((r) => r.map((p, i) => `${i ? "L" : "M"}${(xy(p)[0] - minX + pad).toFixed(8)},${(xy(p)[1] - minY + pad).toFixed(8)}`).join("") + "Z")
    .join("");
  return (
    <svg viewBox={`0 0 ${span + pad * 2} ${span + pad * 2}`} className="aspect-square w-full rounded-xl bg-cream" role="img" aria-label="Parcel outline">
      <path d={d} fill="rgba(180,83,9,0.15)" stroke="#b45309" strokeWidth={span / 120} />
    </svg>
  );
}

const MLS_OFF = "Comes from your MLS — connect the MOMLS/CJMLS data feed to enable.";

function ListingTable({ rows, nearby }: { rows: MlsListing[]; nearby?: boolean }) {
  return (
    <div className="mt-1 overflow-x-auto print:overflow-visible">
      <table className="w-full min-w-[640px] text-left text-sm print:min-w-0 print:text-xs">
        <thead className="text-xs uppercase tracking-wide text-ink-soft">
          <tr>
            {nearby && <th className="py-1">Address</th>}
            <th className={nearby ? "" : "py-1"}>Status</th>
            <th>Price</th>
            <th>Bd / ba</th>
            <th>Sq ft</th>
            <th>{nearby ? "DOM" : "Dates"}</th>
            {nearby && <th>Distance</th>}
            <th>Office</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={`${l.feed}|${l.listingId ?? i}`} className="border-t border-line align-top">
              {nearby && (
                <td className="py-1.5 pr-2">
                  <span className="font-semibold">{l.address}</span>
                  {l.unit && <span> · Unit {l.unit}</span>}
                  {l.propertyType && <span className="block text-xs text-ink-soft">{l.propertyType}</span>}
                </td>
              )}
              <td className={`pr-2 ${nearby ? "" : "py-1.5"}`}>
                {l.status ?? "—"}
                {!nearby && l.listingId && <span className="block text-xs text-ink-soft">#{l.listingId}</span>}
              </td>
              <td className="pr-2">
                {l.closePrice ? `${money(l.closePrice)} sold` : money(l.listPrice)}
                {l.closePrice && l.listPrice ? <span className="block text-xs text-ink-soft">list {money(l.listPrice)}</span> : null}
              </td>
              <td className="pr-2 whitespace-nowrap">
                {l.beds ?? "?"} / {l.baths ?? "?"}
              </td>
              <td className="pr-2">{num(l.sqft)}</td>
              <td className="pr-2 text-xs">
                {nearby
                  ? (l.daysOnMarket ?? "—")
                  : [l.listDate && `listed ${l.listDate}`, l.closeDate && `closed ${l.closeDate}`, l.daysOnMarket != null && `${l.daysOnMarket} DOM`]
                      .filter(Boolean)
                      .join(" · ") || "—"}
              </td>
              {nearby && <td className="pr-2">{l.distanceMi != null ? `${l.distanceMi} mi` : "—"}</td>}
              <td className="text-xs text-ink-soft">{l.office ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "warn" | "bad" | "good" }) {
  const ring = tone === "bad" ? "border-red-300 bg-red-50" : tone === "warn" ? "border-amber-300 bg-amber-50" : tone === "good" ? "border-green-200 bg-green-50" : "border-line bg-white";
  return (
    <div className={`rounded-xl border p-3 ${ring}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-0.5 text-base font-bold leading-snug">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
    </div>
  );
}

const median = (xs: number[]) => {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
};
const fmtAc = (a: number | null | undefined) => (a == null ? "—" : a >= 10 ? a.toFixed(0) : a >= 1 ? a.toFixed(1) : a.toFixed(2));
/** A $1 / $100 deed is a family, estate or quitclaim transfer — not a market price. */
const nominal = (price: number | null | undefined) => price != null && price < 1000;
const zip5 = (z: string | null | undefined) => (z ?? "").slice(0, 5);

/** Public listing sites, for when the MLS feed doesn't cover the area (or to see photos). */
function listingSearchLinks(zip: string, address: string | null) {
  return [
    address ? { label: "This house on Zillow", href: `https://www.zillow.com/homes/${encodeURIComponent(address)}_rb/` } : null,
    zip ? { label: `Zillow · for sale in ${zip}`, href: `https://www.zillow.com/homes/${zip}_rb/` } : null,
    zip ? { label: `Realtor.com · ${zip}`, href: `https://www.realtor.com/realestateandhomes-search/${zip}` } : null,
    zip ? { label: `Redfin · ${zip}`, href: `https://www.redfin.com/zipcode/${zip}` } : null,
  ].filter(Boolean) as { label: string; href: string }[];
}

/** Recent closings on public sites — fills the deed file's lag where there's no MLS feed. */
function soldSearchLinks(zip: string) {
  if (!zip) return [];
  return [
    { label: `Redfin · sold last 6 months in ${zip}`, href: `https://www.redfin.com/zipcode/${zip}/filter/include=sold-6mo` },
    { label: `Zillow · recently sold in ${zip}`, href: `https://www.zillow.com/homes/recently_sold/${zip}_rb/` },
  ];
}

export default async function LeadReport({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ enriched?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const db = await getDb();
  if (!db) notFound();
  const lead = await getLead(db, id);
  if (!lead) notFound();
  const photos = await listPhotoIds(db, id);
  // Risks, missing info and the workflow depend on the seller's latest
  // answers (which can arrive after enrichment) — recompute on every view.
  const facts = { ...leadFacts(lead), photos: photos.length };
  const d: Dossier | null = currentDossier(lead, facts);
  const mls = d?.mls ?? null;
  const listedNow = mls?.subject.data?.activeListing ?? null;
  const distress = d?.insights.distress ?? null;
  const satellite = d && d.geocode.data ? imageUrl(lead.id, "satellite", d.generatedAt) : null;
  const workflow = assignWorkflow(d, facts);
  const g = d?.geocode.data ?? null;
  const p = d?.parcel.data ?? null;
  const c = d?.comps.data ?? null;
  const v = c?.valuation ?? null;
  const src = lead.source as LeadSource;
  const ws = d ? defaultWorksheet(d, lead.condition) : null;
  const a = d?.assessment?.data ?? null;
  const coverage = mls?.coverage ?? null;
  const actives = mls?.nearby.data ?? [];
  const activeMedian = median(actives.map((l) => l.listPrice ?? Number.NaN));
  const activeDom = median(actives.map((l) => l.daysOnMarket ?? Number.NaN));
  const thinMls = coverage?.level === "thin" || coverage?.level === "none";
  const zip = zip5(g?.postal);
  const searchLinks = listingSearchLinks(zip, g?.standardized ?? null);
  const soldLinks = soldSearchLinks(zip);
  // No MLS here (not connected, or the feed barely sees this area): comps are deed-only.
  const noMls = thinMls || !mls || mls.nearby.status === "not_configured";
  const inv = d?.investor?.data ?? null;
  const assessOff = Boolean(a && v && (a.implied < v.low * 0.9 || a.implied > v.high * 1.1));
  const outbound = src.channel === "outbound";
  const lastSale = p?.lastSale ?? null;
  const ch = d?.characteristics ?? null;
  const loadedFiles = d?.history.source?.name.match(/\(([^)]+)\)/)?.[1] ?? null;
  const tel = `tel:+1${lead.phone.replace(/\D/g, "")}`;
  const sms = `sms:+1${lead.phone.replace(/\D/g, "")}`;

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Internal lead report · {site.name} · not for distribution
          </p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight">{g?.standardized ?? lead.addressCurrent}</h1>
          <p className="text-sm text-ink-soft">
            {lead.name} · received {et(lead.createdAt)} ET · lead {lead.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a href={tel} className="rounded-lg bg-accent px-4 py-2 font-bold text-white">
            Call {lead.phone}
          </a>
          <a href={sms} className="rounded-lg border border-accent px-4 py-2 font-bold text-accent">
            Text
          </a>
          <form method="post" action={`/api/admin/leads/${lead.id}/enrich`}>
            <button className="rounded-lg border border-line bg-white px-4 py-2 font-semibold">Re-run enrichment</button>
          </form>
        </div>
      </div>
      {sp.enriched && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-900">Enrichment re-run: {sp.enriched}.</p>}
      {lead.enrichmentStatus === "pending" || lead.enrichmentStatus === "running" ? (
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">Property enrichment is still running — refresh in a minute.</p>
      ) : lead.enrichmentStatus === "failed" ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">
          Enrichment failed ({lead.enrichmentError}). It retries daily, or re-run it now.
        </p>
      ) : null}
      {distress && (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${
            distress.level === "high"
              ? "border-red-300 bg-red-50 text-red-900"
              : distress.level === "some"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : distress.level === "none"
                  ? "border-green-200 bg-green-50 text-green-900"
                  : "border-line bg-white"
          }`}
        >
          <strong>
            Distress: {distress.level === "none" ? "none in the data" : distress.level === "some" ? "some signs" : distress.level}
          </strong>
          {distress.signals.length ? (
            <span> — {distress.signals.map((s) => s.label).join(" · ")}</span>
          ) : (
            <span> — no signals in the records or the seller&apos;s answers; judge the photos.</span>
          )}
        </div>
      )}
      {listedNow && (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          <strong>Currently {listedNow.status} in the MLS</strong>
          {listedNow.office ? ` with ${listedNow.office}` : ""}
          {listedNow.agent ? ` (${listedNow.agent})` : ""}
          {listedNow.listPrice ? ` at ${money(listedNow.listPrice)}` : ""}
          {listedNow.listDate ? ` since ${listedNow.listDate}` : ""}. Unless that's your listing, it's under an exclusive agreement with
          another broker — don't interfere; confirm its status and expiration first.
        </p>
      )}

      {d && (
        <section className="rounded-2xl border border-line bg-cream/40 p-4 break-inside-avoid" aria-label="Diligence snapshot">
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-soft">Diligence snapshot</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
            <Stat
              label="Value — comparable sales"
              value={v ? `${money(v.low)} – ${money(v.high)}` : "No comp range"}
              sub={v ? `${v.confidence} confidence · ${c!.comps.length} sales · ${c!.windowDays} days` : d.comps.note}
              tone={v ? (v.confidence === "low" ? "warn" : undefined) : "warn"}
            />
            <Stat
              label="Value — tax-assessment check"
              value={a ? `≈ ${money(a.implied)}` : "—"}
              sub={
                a
                  ? `${money(a.assessed)} assessed × ${a.ratio.toFixed(2)} (median of ${a.sales} ${a.municipality} sales)${assessOff ? " — disagrees with the comps" : ""}`
                  : (d.assessment?.note ?? "Not computed on this report — re-run enrichment")
              }
              tone={assessOff ? "warn" : a && v ? "good" : undefined}
            />
            <Stat
              label="ARV — flips nearby"
              value={inv?.arv ? `≈ ${money(inv.arv.mid)}` : "No flips found"}
              sub={
                inv?.arv
                  ? `${inv.arv.n} renovated resales · middle half ${money(inv.arv.low)}–${money(inv.arv.high)}`
                  : inv?.flips.length
                    ? `${inv.flips.length} flip${inv.flips.length === 1 ? "" : "s"} nearby — too few for a range; see section 5`
                    : (d.investor?.note ?? "Re-run enrichment to compute")
              }
            />
            <Stat
              label="Investors pay (as-is)"
              value={inv?.buyPrice ? `≈ ${money(inv.buyPrice.mid)}` : "—"}
              sub={
                inv?.buyPrice
                  ? `${inv.buyPrice.n} company purchases · middle half ${money(inv.buyPrice.low)}–${money(inv.buyPrice.high)}`
                  : inv?.buys.length
                    ? `${inv.buys.length} company purchase${inv.buys.length === 1 ? "" : "s"} nearby — too few for a range`
                    : "No company purchases of similar homes nearby"
              }
            />
            <Stat
              label={`Town market (${d.market.data ? `${d.market.data.windowDays} days` : "deeds"})`}
              value={d.market.data ? `${money(d.market.data.medianPrice)} median` : "—"}
              sub={d.market.data ? `${d.market.data.sales} sales · ${d.market.data.medianPpsf ? `$${d.market.data.medianPpsf}/sq ft · ` : ""}${d.market.data.municipality}` : d.market.note}
            />
            <Stat
              label="For sale nearby (MLS)"
              value={mls?.nearby.status === "not_configured" ? "MLS not connected" : `${actives.length} active / pending`}
              sub={
                thinMls
                  ? `MLS feed barely covers this area (${coverage!.closings} closings vs ${coverage!.deeds} deed sales) — check Zillow/Realtor in section 5`
                  : actives.length
                    ? `median ask ${money(activeMedian)}${activeDom != null ? ` · median ${Math.round(activeDom)} days on market` : ""}`
                    : `None in ZIP ${zip || "?"} within 1.5 mi`
              }
              tone={thinMls ? "warn" : undefined}
            />
            <Stat
              label="Ownership"
              value={lastSale?.date ? `Since ${lastSale.date.slice(0, 4)} (${new Date().getFullYear() - Number(lastSale.date.slice(0, 4))} yrs)` : "Transfer date unknown"}
              sub={[
                lastSale?.price != null ? (nominal(lastSale.price) ? `${money(lastSale.price)} transfer — family/estate, not a sale` : `bought for ${money(lastSale.price)}`) : null,
                p?.owner.absentee ? `absentee — bills mail to ${p.owner.mailing}` : p?.owner.mailing ? "tax bills mail to the property" : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              tone={nominal(lastSale?.price) ? "warn" : undefined}
            />
            <Stat
              label="Property"
              value={[
                ch?.bedrooms.value != null ? `${ch.bedrooms.value} bd / ${ch.bathrooms.value ?? "?"} ba` : null,
                ch?.livingSpace.value ? `${num(ch.livingSpace.value)} sq ft` : "sq ft unknown",
              ]
                .filter(Boolean)
                .join(" · ")}
              sub={[
                p ? p.propClassLabel : null,
                ch?.lotAcres.value ? `${fmtAc(ch.lotAcres.value)} ac lot` : null,
                ch?.yearBuilt.value ? `built ${ch.yearBuilt.value}` : null,
                d.flood.data?.zone ? `flood ${d.flood.data.zone}${d.flood.data.sfha ? " (SFHA)" : ""}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              tone={d.flood.data?.sfha ? "warn" : undefined}
            />
            <Stat
              label={outbound ? "From the call" : "Seller said"}
              value={[lead.timeline, lead.condition, lead.occupancy].filter(Boolean).join(" · ") || "Not answered yet"}
              sub={
                lead.notes
                  ? lead.notes.replace(/^From the call:\s*/, "").split("\n")[0]
                  : distress && distress.signals.length
                    ? `Distress: ${distress.signals[0].label}`
                    : undefined
              }
              tone={distress?.level === "high" ? "bad" : distress?.level === "some" ? "warn" : undefined}
            />
            <Stat label="Next step" value={workflow.firstTouch} sub={workflow.label} />
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 1 */}
        <Card n={1} title="Lead status & seller">
          <dl>
            <FactRow label="Seller" value={lead.name} />
            <FactRow label="Mobile" value={<a href={tel} className="underline">{lead.phone}</a>} />
            <FactRow label="Email" value={lead.email ?? "—"} />
            <FactRow label="Timeline" value={lead.timeline ?? "Not answered"} />
            <FactRow label="Priority" value={lead.priority ?? "Not answered"} />
            <FactRow label="Condition" value={lead.condition ?? "Not answered"} />
            <FactRow label="Occupancy" value={lead.occupancy ?? "Not answered"} />
            {(lead.beds || lead.baths) && <FactRow label="Beds / baths (seller)" value={`${lead.beds ?? "?"} bd / ${lead.baths ?? "?"} ba`} />}
            {lead.notes && <FactRow label="Notes" value={<span className="whitespace-pre-wrap font-normal">{lead.notes}</span>} />}
            <FactRow label="Address as submitted" value={lead.addressOriginal} />
            {(lead.addressCurrent !== lead.addressOriginal || lead.addressUnit) && (
              <FactRow label="Seller's correction" value={`${lead.addressCurrent}${lead.addressUnit ? ` · Unit ${lead.addressUnit}` : ""}`} />
            )}
            <FactRow
              label="Source"
              value={
                <>
                  {describeSource(src)}
                  {src.clickIds && Object.keys(src.clickIds).length > 0 && (
                    <span className="block text-xs font-normal text-ink-soft">
                      Click IDs: {Object.keys(src.clickIds).join(", ")}
                      {src.landingPath ? ` · landed on ${src.landingPath}` : ""}
                    </span>
                  )}
                </>
              }
            />
            <FactRow
              label="Consent"
              value={
                outbound ? (
                  <span className="font-normal">✘ None — {String(lead.consent.note ?? "outbound cold call. Never text.")}</span>
                ) : (
                  <span className="font-normal">
                    {lead.consent.checked ? "✔ Agreed to calls/texts" : "✘ Not given"} · {et(lead.consent.timestamp as string)} · IP{" "}
                    {String(lead.consent.ip ?? "")}
                    <span className="block text-xs text-ink-soft">“{String(lead.consent.text ?? "")}”</span>
                  </span>
                )
              }
            />
          </dl>
          <form method="post" action={`/api/admin/leads/${lead.id}/status`} className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
            <label className="text-sm font-semibold" htmlFor="status">
              Pipeline stage
            </label>
            <select id="status" name="status" defaultValue={lead.status} className="rounded-lg border border-line px-2 py-1.5 text-sm">
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button className="rounded-lg bg-ink px-3 py-1.5 text-sm font-semibold text-white">Update</button>
          </form>
          {photos.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold">Seller photos ({photos.length})</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {photos.map((ph) => (
                  <a key={ph.id} href={`/api/admin/photos/${ph.id}`} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/admin/photos/${ph.id}`} alt="Seller photo" className="aspect-square w-full rounded-lg object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </Card>

        {/* 2 */}
        <Card n={2} title="Property image & map">
          {g ? (
            <div className="space-y-3">
              <StreetView lat={g.lat} lng={g.lng} />
              <div className="grid grid-cols-2 gap-3">
                <iframe
                  title="Map"
                  className="aspect-square w-full rounded-xl border border-line"
                  loading="lazy"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${g.lng - 0.004},${g.lat - 0.0028},${g.lng + 0.004},${g.lat + 0.0028}&layer=mapnik&marker=${g.lat},${g.lng}`}
                />
                {satellite ? (
                  <a href={`https://www.google.com/maps/@?api=1&map_action=map&center=${g.lat},${g.lng}&zoom=19&basemap=satellite`} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={satellite} alt="Satellite view, parcel outlined" className="aspect-square w-full rounded-xl object-cover" />
                  </a>
                ) : p?.rings ? (
                  <ParcelShape rings={p.rings} />
                ) : (
                  <div className="flex aspect-square items-center justify-center rounded-xl bg-cream text-xs text-ink-soft">No parcel outline</div>
                )}
              </div>
              <p className="flex flex-wrap gap-x-3 text-xs">
                <a className="underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/@?api=1&map_action=map&center=${g.lat},${g.lng}&zoom=19&basemap=satellite`}>
                  Aerial (Google)
                </a>
                <a className="underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}`}>
                  Google Maps
                </a>
                <span className="text-ink-soft">Map © OpenStreetMap contributors · satellite © Google/Esri · parcel outline from the NJ parcel layer</span>
              </p>
              {d?.photoCheck && (
                <div className="rounded-lg border border-line p-3 text-sm">
                  {d.photoCheck.status === "ok" && d.photoCheck.data ? (
                    <>
                      <p>
                        <strong>Photo check: {d.photoCheck.data.overall}</strong> — {d.photoCheck.data.summary}
                      </p>
                      {d.photoCheck.data.findings.length > 0 && (
                        <ul className="mt-1 list-inside list-disc text-xs">
                          {photoLines(d.photoCheck.data).map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 text-[11px] text-ink-soft">
                        AI read of Street View{d.photoCheck.data.streetViewDate ? ` (${d.photoCheck.data.streetViewDate})` : ""} and satellite ·{" "}
                        {d.photoCheck.data.model} — confirm on the walkthrough.
                      </p>
                    </>
                  ) : (
                    <SourceTag source={null} status={d.photoCheck.status} note={d.photoCheck.note ?? d.photoCheck.error} />
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-ink-soft">No location — the address couldn't be geocoded.</p>
          )}
        </Card>
      </div>

      {/* 3 */}
      <Card n={3} title="Verified property overview">
        {d ? (
          <>
            <div className="grid gap-x-8 md:grid-cols-2">
              <dl>
                <FactRow
                  label="Standardized address"
                  value={g ? `${g.standardized} (${g.match.replace("_", " ")} match, score ${g.score})` : "Not matched"}
                  source={d.geocode.source}
                  status={d.geocode.status}
                />
                <FactRow
                  label="Unit"
                  value={
                    d.unit.status === "not_applicable"
                      ? "Not a condo"
                      : d.unit.status === "matched"
                        ? `Unit ${d.unit.requested} → tax record ${p?.qualifier}`
                        : d.unit.note ?? d.unit.status
                  }
                  source={d.parcel.source}
                />
                <FactRow label="Municipality / county" value={p ? `${p.municipality}, ${p.county}` : "—"} source={d.parcel.source} status={d.parcel.status} />
                <FactRow label="Block / lot / qual" value={p ? `${p.block} / ${p.lot}${p.qualifier ? ` / ${p.qualifier}` : ""}` : "—"} source={d.parcel.source} status={d.parcel.status} />
                <FactRow label="Property class" value={p ? `${p.propClass} — ${p.propClassLabel}` : "—"} source={d.parcel.source} status={d.parcel.status} />
                <FactRow label="Building description" value={p?.buildingDesc ?? "—"} source={d.parcel.source} status={d.parcel.status} />
                <FactRow label="Dwellings" value={num(d.characteristics.dwellings.value)} fact={d.characteristics.dwellings} />
                <FactRow label="Coordinates" value={g ? `${g.lat.toFixed(6)}, ${g.lng.toFixed(6)}` : "—"} source={d.geocode.source} status={d.geocode.status} />
              </dl>
              <dl>
                <FactRow label="Living area" value={`${num(d.characteristics.livingSpace.value)} sq ft`} fact={d.characteristics.livingSpace} />
                <FactRow label="Lot size" value={`${num(d.characteristics.lotAcres.value, 2)} acres`} fact={d.characteristics.lotAcres} />
                <FactRow label="Year built" value={String(d.characteristics.yearBuilt.value ?? "")} fact={d.characteristics.yearBuilt} />
                <FactRow label="Bedrooms / baths" value={`${num(d.characteristics.bedrooms.value)} bd / ${num(d.characteristics.bathrooms.value, 1)} ba`} fact={d.characteristics.bedrooms} />
                <FactRow label="Flood zone" value={d.flood.data ? `${d.flood.data.zone}${d.flood.data.subtype ? ` — ${d.flood.data.subtype.toLowerCase()}` : ""}${d.flood.data.sfha ? " · SPECIAL FLOOD HAZARD AREA" : ""}${d.flood.data.baseFloodElevation != null ? ` · BFE ${d.flood.data.baseFloodElevation} ft` : ""}` : "—"} source={d.flood.source} status={d.flood.status} />
                <FactRow label="Zoning" value="—" status={d.zoning.status} source={null} />
                <FactRow label="Owner mailing address" value={p?.owner.mailing ? `${p.owner.mailing}${p.owner.absentee ? " (absentee)" : ""}` : "—"} source={d.parcel.source} status={p?.owner.mailing ? "ok" : "missing"} />
                {p?.owner.name && <FactRow label="Owner of record" value={p.owner.name} source={d.parcel.source} />}
              </dl>
            </div>
            {d.zoning.note && <p className="mt-2 text-xs text-ink-soft">Zoning: {d.zoning.note}</p>}
            {d.conflicts.length > 0 && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">
                <strong>Sources disagree:</strong>
                <ul className="mt-1 list-inside list-disc">
                  {d.conflicts.map((cf) => (
                    <li key={cf.field}>
                      {cf.field}: {cf.values.map((x) => `${x.value} (${x.source})`).join(" vs ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.unit.candidates && d.unit.status !== "matched" && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold">Units on this tax lot ({d.unit.candidates.length}{d.unit.candidates.length >= 60 ? "+" : ""})</summary>
                <p className="mt-1 text-xs text-ink-soft">{d.unit.candidates.map((u) => u.location).join(" · ")}</p>
              </details>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-soft">Not enriched yet.</p>
        )}
      </Card>

      {/* 4 */}
      <Card n={4} title="Tax & transfer history">
        {d ? (
          <div className="grid gap-6 md:grid-cols-2">
            <dl>
              <FactRow label="Assessed — land" value={money(p?.assessed.land)} source={d.parcel.source} status={p?.assessed.land != null ? "ok" : "missing"} />
              <FactRow label="Assessed — improvements" value={money(p?.assessed.improvement)} source={d.parcel.source} status={p?.assessed.improvement != null ? "ok" : "missing"} />
              <FactRow label="Assessed — net" value={money(p?.assessed.net)} source={d.parcel.source} status={p?.assessed.net != null ? "ok" : "missing"} />
              <FactRow label="Last year's taxes" value={money(p?.lastYearTaxes)} source={d.parcel.source} status={p?.lastYearTaxes != null ? "ok" : "missing"} />
              <FactRow
                label="Last sale on tax list"
                value={
                  p?.lastSale ? (
                    <>
                      {`${p.lastSale.date ?? "undated"} · ${money(p.lastSale.price)}${p.lastSale.deedBook ? ` · deed ${p.lastSale.deedBook}/${p.lastSale.deedPage}` : ""}`}
                      {nominal(p.lastSale.price) && (
                        <span className="block text-xs font-normal text-amber-800">Nominal price — a family, estate or quitclaim transfer, not a market sale.</span>
                      )}
                    </>
                  ) : (
                    "—"
                  )
                }
                source={d.parcel.source}
                status={p?.lastSale ? "ok" : "missing"}
              />
            </dl>
            <div>
              <p className="text-sm font-semibold">Recorded transfers (SR1A)</p>
              {d.history.data && d.history.data.length > 0 ? (
                <table className="mt-1 w-full text-sm">
                  <thead className="text-left text-xs text-ink-soft">
                    <tr>
                      <th>Deed date</th>
                      <th>Price</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.history.data.map((h, i) => (
                      <tr key={i} className="border-t border-line align-top">
                        <td className="py-1 pr-2 whitespace-nowrap">{h.date ?? "—"}</td>
                        <td className="py-1 pr-2">{money(h.price)}</td>
                        <td className="py-1 text-xs">{h.usable ? "Arm's-length (usable)" : h.nuLabel ?? `Non-usable ${h.nuCode ?? ""}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-1 text-sm text-ink-soft">
                  None in the deed files loaded so far{loadedFiles ? ` (${loadedFiles})` : ""} — older transfers need earlier years loaded; the tax list&apos;s
                  last sale is on the left.
                </p>
              )}
              <div className="mt-1">
                <SourceTag source={d.history.source} />
              </div>
              <SectionNote s={d.history} />
              {d.distress.data && d.distress.data.indicators.length > 0 && (
                <p className="mt-2 text-xs">
                  <strong>Deed-code indicators:</strong> {d.distress.data.indicators.join("; ")}
                </p>
              )}
              <p className="mt-2 text-xs text-ink-soft">{d.distress.note}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-sm font-semibold">MLS history</p>
              {mls?.subject.data?.records.length ? (
                <ListingTable rows={mls.subject.data.records} />
              ) : (
                <SourceTag source={null} status={mls?.subject.status ?? "not_configured"} note={mls?.subject.note ?? MLS_OFF} />
              )}
              {mls?.subject.status === "ok" && <SourceTag source={mls.subject.source} />}
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">Not enriched yet.</p>
        )}
      </Card>

      {/* 5 */}
      <Card n={5} title="Comparable sales — sold, investor deals, for sale">
        {d && noMls && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Deed-only comps — no MLS feed covers this area.</strong> Sales come from the state deed file
            {d.comps.source?.asOf ? ` (${d.comps.source.asOf})` : ""}, so the last few months of closings aren&apos;t in yet, and there are no beds/baths,
            photos or condition — a renovated house and a gut job look the same. Use the flips below for ARV, ask the seller for beds/baths, and check
            recent sales before pricing:{" "}
            {soldLinks.map((l, i) => (
              <span key={l.href}>
                {i > 0 && " · "}
                <a className="underline" target="_blank" rel="noopener noreferrer" href={l.href}>
                  {l.label}
                </a>
              </span>
            ))}
          </div>
        )}
        <p className="text-sm font-semibold">Sold (closed, arm&apos;s-length)</p>
        {c && c.comps.length > 0 ? (
          <>
            <div className="mt-1 overflow-x-auto print:overflow-visible">
              <table className="w-full min-w-[760px] text-left text-sm print:min-w-0 print:text-xs">
                <thead className="text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="py-1">Address</th>
                    <th>Sold</th>
                    <th>Price</th>
                    <th>Sq ft</th>
                    <th>$/sq ft</th>
                    <th>Bd / ba</th>
                    <th>Built</th>
                    <th>Lot</th>
                    <th>Distance</th>
                    <th>Differences</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t-2 border-ink/20 bg-cream/60 align-top font-semibold">
                    <td className="py-1.5 pr-2">
                      This property
                      <span className="block text-xs font-normal text-ink-soft">{p ? `${p.municipality} · ${p.pin}` : ""}</span>
                    </td>
                    <td className="pr-2 text-xs font-normal">{lastSale?.date ? `${lastSale.date}${nominal(lastSale.price) ? " (nominal)" : ""}` : "—"}</td>
                    <td className="pr-2">{v ? `${money(v.mid)} est.` : "—"}</td>
                    <td className="pr-2">{num(ch?.livingSpace.value)}</td>
                    <td className="pr-2">{v && ch?.livingSpace.value ? `$${Math.round(v.mid / ch.livingSpace.value)}` : "—"}</td>
                    <td className="pr-2 whitespace-nowrap">
                      {ch?.bedrooms.value != null || ch?.bathrooms.value != null ? `${ch?.bedrooms.value ?? "?"} / ${ch?.bathrooms.value ?? "?"}` : "—"}
                    </td>
                    <td className="pr-2">{ch?.yearBuilt.value ?? "—"}</td>
                    <td className="pr-2 whitespace-nowrap">{ch?.lotAcres.value ? `${fmtAc(ch.lotAcres.value)} ac` : "—"}</td>
                    <td className="pr-2">—</td>
                    <td className="text-xs font-normal text-ink-soft">Subject</td>
                  </tr>
                  {c.comps.map((x) => (
                    <tr key={x.pin} className="border-t border-line align-top">
                      <td className="py-1.5 pr-2">
                        <a
                          className="font-semibold underline decoration-line underline-offset-2"
                          target="_blank"
                          rel="noopener noreferrer"
                          href={
                            x.lat != null && x.lng != null
                              ? `https://www.google.com/maps/search/?api=1&query=${x.lat},${x.lng}`
                              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${x.address}, ${x.municipality ?? ""}, NJ`)}`
                          }
                        >
                          {x.address}
                        </a>
                        <span className="block text-xs text-ink-soft">
                          {x.municipality ?? ""} ·{" "}
                          <span className={`rounded px-1 font-semibold ${x.source === "deed" ? "bg-cream" : "bg-blue-50 text-blue-900"}`}>
                            {x.source === "mls" ? "MLS closing" : x.source === "deed+mls" ? "deed + MLS" : "deed"}
                          </span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap pr-2">{x.saleDate}</td>
                      <td className="pr-2">{money(x.price)}</td>
                      <td className="pr-2">{num(x.livingSpace)}</td>
                      <td className="pr-2">
                        {x.ppsf ? `$${x.ppsf}` : "—"}
                        {x.pricePerUnit && <span className="block text-xs text-ink-soft">{money(x.pricePerUnit)}/unit</span>}
                        {x.pricePerAcre && c.kind === "land" && <span className="block text-xs text-ink-soft">{money(x.pricePerAcre)}/ac</span>}
                      </td>
                      <td className="pr-2 whitespace-nowrap">{x.beds != null || x.baths != null ? `${x.beds ?? "?"} / ${x.baths ?? "?"}` : "—"}</td>
                      <td className="pr-2">{x.yearBuilt ?? "—"}</td>
                      <td className="pr-2 whitespace-nowrap">{x.acres ? `${fmtAc(x.acres)} ac` : "—"}</td>
                      <td className="pr-2 whitespace-nowrap">{x.distanceMi != null ? `${x.distanceMi} mi` : "—"}</td>
                      {/* Reports built before distance got its own column repeated it here. */}
                      <td className="text-xs text-ink-soft">{x.differences.filter((t) => !/ mi away$/.test(t)).join(" · ") || "Similar"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              Search: {c.steps.map((st) => `${st.label} (${st.qualifying})`).join(" → ")}.{" "}
              {c.pool
                ? `Pool: ${c.pool.deed} arm's-length deed sales${c.pool.merged ? ` (${c.pool.merged} matched to MLS closings for beds/baths)` : ""}${c.pool.mls ? ` + ${c.pool.mls} MLS-only closings` : ""}.`
                : "Closed arm's-length sales only."}{" "}
              Family, estate, foreclosure and other non-usable deeds are excluded. Prices are as recorded — no adjustments.
            </p>
            <SourceTag source={d!.comps.source} />
          </>
        ) : (
          <p className="text-sm text-ink-soft">{d?.comps.note ?? c?.note ?? "No comparable sales."}</p>
        )}
        {d && <SectionNote s={d.comps} />}
        {d?.investor && (
          <div className="mt-5">
            <p className="text-sm font-semibold">Investor deals nearby — flips (ARV) and company purchases (as-is price)</p>
            {inv && (inv.flips.length > 0 || inv.buys.length > 0) ? (
              <>
                <div className="mt-1 overflow-x-auto print:overflow-visible">
                  <table className="w-full min-w-[720px] text-left text-sm print:min-w-0 print:text-xs">
                    <thead className="text-xs uppercase tracking-wide text-ink-soft">
                      <tr>
                        <th className="py-1">Address</th>
                        <th>Deal</th>
                        <th>Bought (as-is)</th>
                        <th>Resold (renovated)</th>
                        <th>Sq ft</th>
                        <th>Built</th>
                        <th>Distance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.flips.map((x) => (
                        <tr key={`f-${x.pin}`} className="border-t border-line align-top">
                          <td className="py-1.5 pr-2">
                            <span className="font-semibold">{x.address}</span>
                            <span className="block text-xs text-ink-soft">{x.municipality ?? ""}</span>
                          </td>
                          <td className="pr-2 text-xs">
                            <span className="rounded bg-green-50 px-1 font-semibold text-green-900">Flip</span> held {Math.round(x.daysHeld / 30)} mo · +
                            {Math.round((x.sellPrice / x.buyPrice - 1) * 100)}%
                          </td>
                          <td className="pr-2">
                            {money(x.buyPrice)}
                            <span className="block text-xs text-ink-soft">
                              {x.buyDate}
                              {x.buyType !== "arm's-length" ? ` · ${x.buyType}` : ""}
                              {x.buyer ? ` · ${x.buyer}` : ""}
                            </span>
                          </td>
                          <td className="pr-2">
                            <strong>{money(x.sellPrice)}</strong>
                            <span className="block text-xs text-ink-soft">
                              {x.sellDate}
                              {x.livingSpace ? ` · $${Math.round(x.sellPrice / x.livingSpace)}/sq ft` : ""}
                            </span>
                          </td>
                          <td className="pr-2">{num(x.livingSpace)}</td>
                          <td className="pr-2">{x.yearBuilt ?? "—"}</td>
                          <td className="pr-2 whitespace-nowrap">{x.distanceMi} mi</td>
                        </tr>
                      ))}
                      {inv.buys.map((x) => (
                        <tr key={`b-${x.pin}`} className="border-t border-line align-top">
                          <td className="py-1.5 pr-2">
                            <span className="font-semibold">{x.address}</span>
                            <span className="block text-xs text-ink-soft">{x.municipality ?? ""}</span>
                          </td>
                          <td className="pr-2 text-xs">
                            <span className="rounded bg-cream px-1 font-semibold">Company buy</span>
                            {x.buyType !== "arm's-length" ? ` · ${x.buyType}` : ""}
                          </td>
                          <td className="pr-2">
                            {money(x.price)}
                            <span className="block text-xs text-ink-soft">
                              {x.date} · {x.buyer}
                            </span>
                          </td>
                          <td className="pr-2 text-xs text-ink-soft">not resold yet</td>
                          <td className="pr-2">{num(x.livingSpace)}</td>
                          <td className="pr-2">{x.yearBuilt ?? "—"}</td>
                          <td className="pr-2 whitespace-nowrap">{x.distanceMi} mi</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul className="mt-2 list-inside list-disc text-xs text-ink-soft">
                  {inv.arv && <li>ARV: {inv.arv.method} → {money(inv.arv.low)}–{money(inv.arv.high)}, midpoint {money(inv.arv.mid)} (used as the worksheet&apos;s ARV).</li>}
                  {inv.buyPrice && (
                    <li>
                      As-is investor price: {inv.buyPrice.method} → {money(inv.buyPrice.low)}–{money(inv.buyPrice.high)}, midpoint {money(inv.buyPrice.mid)}.
                    </li>
                  )}
                  <li>
                    Flip = same parcel resold within 18 months for 25%+ more (resale arm&apos;s-length). Company buy = an LLC/Inc/Holdings-type buyer, arm&apos;s-length
                    or a sheriff&apos;s/foreclosure/short/lien sale. Similar size and era only, within {inv.radiusMi} mi, last {Math.round(inv.windowDays / 365)} years
                    of loaded deeds.
                  </li>
                </ul>
                <SourceTag source={d.investor.source} />
              </>
            ) : (
              <SectionNote s={d.investor} />
            )}
          </div>
        )}
        {d && (
          <div className="mt-5">
            <p className="text-sm font-semibold">For sale now — active, under contract &amp; pending within 1.5 mi (the seller&apos;s competition)</p>
            {thinMls && (
              <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-900">
                The MLS feed barely covers this area — it saw {coverage!.closings} of the {coverage!.deeds} sales in the deed file over two years
                {p ? ` (${p.county} County)` : ""}. An empty or short list here does NOT mean there&apos;s no competition: check the public sites below.
              </p>
            )}
            {actives.length ? (
              <>
                <p className="mt-1 text-xs">
                  <strong>{actives.length}</strong> listed · median ask <strong>{money(activeMedian)}</strong>
                  {activeDom != null && (
                    <>
                      {" "}
                      · median <strong>{Math.round(activeDom)}</strong> days on market
                    </>
                  )}
                  {(() => {
                    const ppsf = median(actives.map((l) => (l.listPrice && l.sqft ? l.listPrice / l.sqft : Number.NaN)));
                    return ppsf ? ` · median ask $${Math.round(ppsf)}/sq ft` : "";
                  })()}
                </p>
                <ListingTable rows={actives} nearby />
                <p className="mt-1 text-xs text-ink-soft">{mls!.nearby.note} Asking prices, not sales — not used in the value range.</p>
                <SourceTag source={mls!.nearby.source} />
              </>
            ) : (
              <SourceTag source={null} status={mls?.nearby.status ?? "not_configured"} note={mls?.nearby.note ?? MLS_OFF} />
            )}
            {searchLinks.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs print:hidden">
                <span className="text-ink-soft">Public listings:</span>
                {searchLinks.map((l) => (
                  <a key={l.href} className="underline" target="_blank" rel="noopener noreferrer" href={l.href}>
                    {l.label}
                  </a>
                ))}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* 6 */}
      <Card n={6} title="Market valuation analysis" estimate>
        {v ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-ink-soft">Preliminary market-value range (as-is)</p>
              <p className="text-3xl font-extrabold tracking-tight">
                {money(v.low)} – {money(v.high)}
              </p>
              <p className="text-sm">
                Midpoint {money(v.mid)} · <strong>{v.confidence} confidence</strong>
              </p>
              {v.ownSale && (
                <p className={`mt-2 rounded-lg px-2 py-1 text-sm ${v.ownSale.inRange ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
                  This property sold {v.ownSale.date} for <strong>{money(v.ownSale.price)}</strong> ({v.ownSale.source}) —{" "}
                  {v.ownSale.inRange ? "consistent with the range." : `${v.ownSale.price < v.low ? "below" : "above"} the range; weigh that sale heavily.`}
                </p>
              )}
              <p className="mt-2 text-xs text-ink-soft">Method: {v.method}. Computed only from the comparable sales above.</p>
              <ul className="mt-2 list-inside list-disc text-xs text-ink-soft">
                {v.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-3 text-sm">
              {a ? (
                <div className={`rounded-lg p-3 ${assessOff ? "bg-amber-100/70" : "bg-white"}`}>
                  <p className="font-semibold">Tax-assessment cross-check: ≈ {money(a.implied)}</p>
                  <p>
                    Assessed {money(a.assessed)} × {a.ratio.toFixed(2)} — what {a.sales} arm&apos;s-length {a.segment} sales in {a.municipality} fetched per
                    assessed dollar (last {a.windowDays} days; middle half {a.p25.toFixed(2)}–{a.p75.toFixed(2)} → {money(a.low)}–{money(a.high)}).
                  </p>
                  <p className="mt-1 text-xs">
                    {assessOff
                      ? `Outside the comp range — independent of comp selection, so check the lot (${ch?.lotAcres.value ? `${fmtAc(ch.lotAcres.value)} ac` : "size unknown"}), condition and whether the comps are really alike.`
                      : "Agrees with the comp range."}
                  </p>
                  <SourceTag source={d!.assessment!.source} />
                </div>
              ) : (
                d?.assessment && <SectionNote s={d.assessment} />
              )}
              {d?.market.data ? (
                <div className="rounded-lg bg-white p-3">
                  <p className="font-semibold">
                    {d.market.data.municipality} market ({d.market.data.segment}, last {d.market.data.windowDays} days)
                  </p>
                  <p>
                    {d.market.data.sales} sales · median {money(d.market.data.medianPrice)} (middle half {money(d.market.data.p25Price)}–
                    {money(d.market.data.p75Price)})
                    {d.market.data.medianPpsf ? ` · median $${d.market.data.medianPpsf}/sq ft` : ""}
                  </p>
                  <SourceTag source={d.market.source} />
                </div>
              ) : (
                d && <SectionNote s={d.market} />
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-soft">No value range — {d?.comps.note ?? "not enough comparable sales"}.</p>
        )}
      </Card>

      {/* 7 */}
      <Card n={7} title="Acquisition considerations" estimate>
        {ws ? <Worksheet initial={ws.inputs} basis={ws.basis} /> : <p className="text-sm text-ink-soft">Available after enrichment.</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 8 */}
        <Card n={8} title="Risks & missing information">
          {d && d.insights.risks.length > 0 ? (
            <ul className="space-y-1.5 text-sm">
              {d.insights.risks.map((r) => (
                <li key={r} className="flex gap-2">
                  <span aria-hidden className="text-accent">▲</span>
                  {r}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-soft">No risk flags from the data.</p>
          )}
          {d && (
            <>
              <p className="mt-4 text-sm font-semibold">Missing — ask or verify</p>
              <ul className="mt-1 list-inside list-disc text-sm text-ink-soft">
                {d.insights.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          )}
        </Card>

        {/* 9 */}
        <Card n={9} title="Recommended follow-up">
          {workflow ? (
            <>
              <p className="text-sm">
                <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-white">{workflow.label}</span>
              </p>
              <p className="mt-2 font-semibold">First touch: {workflow.firstTouch}</p>
              <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
                {workflow.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {workflow.tags.length > 0 && (
                <p className="mt-3 flex flex-wrap gap-1">
                  {workflow.tags.map((t) => (
                    <span key={t} className="rounded bg-cream px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft">
                      {t}
                    </span>
                  ))}
                </p>
              )}
              <p className="mt-3 text-xs text-ink-soft">Offers are never sent automatically — every number needs your review first.</p>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Not assigned yet.</p>
          )}
        </Card>
      </div>

      {/* 10 */}
      <Card n={10} title="Sources & report timestamp">
        <p className="text-sm">
          Report generated {et(d?.generatedAt)} ET{lead.enrichedAt ? "" : " (not enriched)"} · lead updated {et(lead.updatedAt)} ET ·
          enrichment {lead.enrichmentStatus} (attempts: {lead.enrichmentAttempts})
        </p>
        {d && (
          <ul className="mt-2 space-y-1 text-sm">
            {d.sources.map((s) => (
              <li key={s.id}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {s.name}
                  </a>
                ) : (
                  s.name
                )}
                <span className="text-xs text-ink-soft">
                  {asOf(s)} · retrieved {et(s.retrievedAt)} ET
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-semibold">Activity log ({lead.events.length})</summary>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-soft">
            {lead.events.map((e, i) => (
              <li key={i}>
                {et(e.at)} · {e.type}
                {Array.isArray(e.fields) ? ` (${(e.fields as string[]).join(", ")})` : ""}
                {e.status ? ` → ${String(e.status)}` : ""}
              </li>
            ))}
          </ul>
        </details>
        <p className="mt-3 text-xs text-ink-soft print:hidden">
          <Link href="/admin" className="underline">
            ← All leads
          </Link>
        </p>
      </Card>
    </div>
  );
}
