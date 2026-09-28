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
    <div className="mt-1 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
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
                <span className="font-normal">
                  {lead.consent.checked ? "✔ Agreed to calls/texts" : "✘ Not given"} · {et(lead.consent.timestamp as string)} · IP{" "}
                  {String(lead.consent.ip ?? "")}
                  <span className="block text-xs text-ink-soft">“{String(lead.consent.text ?? "")}”</span>
                </span>
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
                value={p?.lastSale ? `${p.lastSale.date ?? "undated"} · ${money(p.lastSale.price)}${p.lastSale.deedBook ? ` · deed ${p.lastSale.deedBook}/${p.lastSale.deedPage}` : ""}` : "—"}
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
                <p className="mt-1 text-sm text-ink-soft">None in the loaded deed years.</p>
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
      <Card n={5} title="Comparable sales">
        {c && c.comps.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="py-1">Address</th>
                    <th>Sold</th>
                    <th>Price</th>
                    <th>Sq ft</th>
                    <th>$/sq ft</th>
                    <th>Bd / ba</th>
                    <th>Built</th>
                    <th>Distance</th>
                    <th>Differences</th>
                  </tr>
                </thead>
                <tbody>
                  {c.comps.map((x) => (
                    <tr key={x.pin} className="border-t border-line align-top">
                      <td className="py-1.5 pr-2">
                        <span className="font-semibold">{x.address}</span>
                        <span className="block text-xs text-ink-soft">
                          {x.municipality ?? ""} · {x.source === "mls" ? "MLS closing" : x.source === "deed+mls" ? `deed + MLS · ${x.pin}` : x.pin}
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
                      <td className="pr-2">{x.distanceMi != null ? `${x.distanceMi} mi` : "—"}</td>
                      <td className="text-xs text-ink-soft">{x.differences.join(" · ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-soft">
              Search: {c.steps.map((s) => `${s.label} (${s.qualifying})`).join(" → ")}.{" "}
              {c.pool
                ? `Pool: ${c.pool.deed} arm's-length deed sales${c.pool.merged ? ` (${c.pool.merged} matched to MLS closings for beds/baths)` : ""}${c.pool.mls ? ` + ${c.pool.mls} MLS-only closings` : ""}.`
                : "Closed arm's-length sales only."}
            </p>
            <SourceTag source={d!.comps.source} />
          </>
        ) : (
          <p className="text-sm text-ink-soft">{d?.comps.note ?? c?.note ?? "No comparable sales."}</p>
        )}
        {d && <SectionNote s={d.comps} />}
        {d && (
          <div className="mt-5">
            <p className="text-sm font-semibold">Active & pending listings nearby — the seller's competition</p>
            {mls?.nearby.data?.length ? (
              <>
                <ListingTable rows={mls.nearby.data} nearby />
                <p className="mt-1 text-xs text-ink-soft">{mls.nearby.note} Asking prices, not sales — not used in the value range.</p>
                <SourceTag source={mls.nearby.source} />
              </>
            ) : (
              <SourceTag source={null} status={mls?.nearby.status ?? "not_configured"} note={mls?.nearby.note ?? MLS_OFF} />
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
