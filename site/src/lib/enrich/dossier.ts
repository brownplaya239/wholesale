/**
 * Builds a property dossier for an address. Each provider runs independently;
 * one failing only marks its own section — the rest of the dossier still
 * builds. Nothing here writes to the lead record (see leads/enrich.ts).
 */
import type { Db } from "@/lib/db";
import { selectComps, type CompCandidate, type Subject } from "./comps";
import { floodZone } from "./flood";
import { cleanAddress, extractUnit, geocode } from "./geocode";
import { nowIso } from "./http";
import { buildInsights, type LeadFacts } from "./insights";
import { mlsConfigured, mlsNearby, mlsSubject, type MlsListing, type MlsSubject } from "./mls";
import { fetchPinAttrs, lookupParcel, muncodesNear, type PinAttrs } from "./parcel";
import {
  compCandidates,
  deedHistory,
  marketStats,
  salesLoaded,
  sameBuildingSales,
  sr1aSource,
  type Candidate,
} from "./sales";
import type {
  Characteristics,
  CompsResult,
  Conflict,
  DeedRecord,
  Dossier,
  Fact,
  GeocodeData,
  MarketStats,
  ParcelData,
  Section,
  SourceRef,
} from "./types";

const noDb = <T,>(what: string): Section<T> => ({
  status: "not_configured",
  data: null,
  source: null,
  note: `${what} needs the lead database (DATABASE_URL) and loaded deed data.`,
});

function fact<T>(value: T | null | undefined, source: SourceRef | null, fallback: Fact<T>["status"] = "missing"): Fact<T> {
  return value == null ? { value: null, status: fallback, source: null } : { value, status: "ok", source };
}

/**
 * Picks each characteristic from the best source (official records first,
 * MLS next) and records every disagreement between sources.
 */
export function mergeCharacteristics(
  parcel: Section<ParcelData>,
  history: Section<DeedRecord[]>,
  mls: Section<MlsSubject>
): { characteristics: Characteristics; conflicts: Conflict[] } {
  const p = parcel.data;
  const deeds = history.data ?? [];
  const m = mls.data;
  const mlsStatus = mls.status === "not_configured" ? "not_configured" : "missing";
  const deedSqft = deeds.find((d) => d.livingSpace)?.livingSpace ?? null;
  const deedYear = deeds.find((d) => d.yearBuilt)?.yearBuilt ?? null;

  const livingSpace = deedSqft ? fact(deedSqft, history.source) : fact(m?.sqft, mls.source, mlsStatus);
  const yearBuilt = p?.yearBuilt
    ? fact(p.yearBuilt, parcel.source)
    : deedYear
      ? fact(deedYear, history.source)
      : fact(m?.yearBuilt, mls.source, mlsStatus);
  const lotAcres = p?.acres ? fact(p.acres, parcel.source) : fact(m?.lotAcres, mls.source, mlsStatus);

  const conflicts: Conflict[] = [];
  const years = [
    p?.yearBuilt ? { value: p.yearBuilt, source: "tax list" } : null,
    deedYear ? { value: deedYear, source: "deed record" } : null,
    m?.yearBuilt ? { value: m.yearBuilt, source: "MLS" } : null,
  ].filter(Boolean) as { value: number; source: string }[];
  if (years.length > 1 && Math.max(...years.map((y) => y.value)) - Math.min(...years.map((y) => y.value)) > 2) {
    // Sources that agree share one entry: "1988 (tax list, deed record) vs 1960 (MLS)".
    const grouped = new Map<number, string[]>();
    for (const y of years) grouped.set(y.value, [...(grouped.get(y.value) ?? []), y.source]);
    conflicts.push({ field: "year built", values: [...grouped].map(([value, src]) => ({ value: String(value), source: src.join(", ") })) });
  }
  if (deedSqft && m?.sqft && Math.abs(deedSqft - m.sqft) / deedSqft > 0.1) {
    conflicts.push({
      field: "living area",
      values: [
        { value: `${deedSqft.toLocaleString()} sq ft`, source: "deed record" },
        { value: `${m.sqft.toLocaleString()} sq ft`, source: "MLS" },
      ],
    });
  }
  if (p?.acres && m?.lotAcres && Math.abs(p.acres - m.lotAcres) / p.acres > 0.25) {
    conflicts.push({
      field: "lot size",
      values: [
        { value: `${p.acres.toFixed(2)} ac`, source: "parcel map" },
        { value: `${m.lotAcres.toFixed(2)} ac`, source: "MLS" },
      ],
    });
  }
  return {
    conflicts,
    characteristics: {
      livingSpace,
      yearBuilt,
      bedrooms: fact(m?.beds, mls.source, mlsStatus),
      bathrooms: fact(m?.baths, mls.source, mlsStatus),
      lotAcres,
      dwellings: fact(p?.dwellings, parcel.source),
    },
  };
}

const SELLER_SOURCE: SourceRef = { id: "seller", name: "Seller-reported (thank-you page)", retrievedAt: "" };

/** "5+" -> 5, "2.5" -> 2.5 */
const sellerNum = (v: string | null | undefined) => (v ? Number.parseFloat(v) : Number.NaN);

/**
 * Seller's own bed/bath answers: fill the gap when no MLS record exists, and
 * flag it when they disagree with the MLS. Answers can arrive after
 * enrichment, so the report applies this on every view.
 */
export function withSellerFacts(d: Dossier, facts: Pick<LeadFacts, "beds" | "baths">): Dossier {
  const out: Dossier = { ...d, characteristics: { ...d.characteristics }, conflicts: [...d.conflicts] };
  for (const [key, answer, label] of [
    ["bedrooms", facts.beds, "bedrooms"],
    ["bathrooms", facts.baths, "bathrooms"],
  ] as const) {
    const n = sellerNum(answer);
    if (Number.isNaN(n)) continue;
    const cur = out.characteristics[key];
    if (cur.status !== "ok") {
      out.characteristics[key] = {
        value: n,
        status: "ok",
        source: SELLER_SOURCE,
        note: answer?.endsWith("+") ? `${answer} (or more)` : undefined,
      };
    } else if (cur.value != null && cur.value !== n && !(answer?.endsWith("+") && cur.value >= n)) {
      if (!out.conflicts.some((c) => c.field === label)) {
        out.conflicts.push({
          field: label,
          values: [
            { value: String(cur.value), source: cur.source?.id === "mls" ? "MLS" : cur.source?.name ?? "records" },
            { value: answer!, source: "seller" },
          ],
        });
      }
    }
  }
  return out;
}

async function runComps(
  db: Db,
  p: ParcelData,
  g: GeocodeData,
  chars: Characteristics,
  source: SourceRef
): Promise<Section<CompsResult>> {
  if (!(await salesLoaded(db))) {
    return { status: "missing", data: null, source, note: "Deed-sales data hasn't been loaded yet (run the SR1A ingest)." };
  }
  const subject: Subject = {
    kind: p.kind,
    pin: p.pin,
    muncode: p.muncode,
    block: p.block,
    lot: p.lot,
    lat: g.lat,
    lng: g.lng,
    livingSpace: chars.livingSpace.value,
    yearBuilt: chars.yearBuilt.value,
    acres: chars.lotAcres.value,
    dwellings: chars.dwellings.value,
  };
  let muncodes = [p.muncode];
  try {
    muncodes = [...new Set([p.muncode, ...(await muncodesNear(g.lat, g.lng, p.kind === "land" ? 6 : 3))])];
  } catch {
    // Neighboring towns unavailable — search the home municipality only.
  }
  const lists: Candidate[][] = [
    await compCandidates(db, {
      muncodes,
      homeMuncode: p.muncode,
      sinceDays: 730,
      kind: p.kind,
      propClass: p.propClass,
      excludePin: p.pin,
      livingSpace: subject.livingSpace,
    }),
  ];
  if (p.kind === "condo") lists.push(await sameBuildingSales(db, p.muncode, p.block, p.lot, p.pin));
  const byPin = new Map<string, Candidate>();
  for (const c of lists.flat()) if (!byPin.has(c.pin)) byPin.set(c.pin, c);
  let attrs = new Map<string, PinAttrs>();
  let note: string | undefined;
  try {
    attrs = await fetchPinAttrs([...byPin.keys()]);
  } catch (err) {
    note = `Comp locations unavailable (${String(err)}); distance-based steps skipped.`;
  }
  const candidates: CompCandidate[] = [...byPin.values()].map((c) => {
    const a = attrs.get(c.pin);
    return {
      ...c,
      municipality: a?.municipality ?? null,
      lat: a?.lat ?? null,
      lng: a?.lng ?? null,
      dwellings: a?.dwellings ?? null,
      acres: a?.acres ?? null,
    };
  });
  const result = selectComps(subject, candidates);
  if (note) result.note = [result.note, note].filter(Boolean).join(" ");
  return {
    status: result.comps.length ? "ok" : "missing",
    data: result,
    source,
    note: result.comps.length ? undefined : "No qualifying comparable sales in the loaded deed data.",
  };
}

export type DossierInput = { address: string; unit: string | null; lead: LeadFacts };

export async function buildDossier(input: DossierInput, db: Db | null): Promise<Dossier> {
  const parsed = extractUnit(cleanAddress(input.address));
  const unit = input.unit?.trim() || parsed.unit;

  const geo = await geocode(parsed.base, unit);
  const g = geo.data;
  const skipped = <T,>(): Section<T> => ({
    status: g ? "missing" : mlsConfigured() ? "missing" : "not_configured",
    data: null,
    source: null,
    note: "Skipped — address not geocoded.",
  });

  const [parcelRes, flood, mlsProperty, mlsListings] = await Promise.all([
    g
      ? lookupParcel(g.lat, g.lng, parsed.base, unit)
      : Promise.resolve({
          parcel: { status: "missing", data: null, source: null, note: "Skipped — address not geocoded." } as Section<ParcelData>,
          unit: { status: "not_applicable" as const, requested: unit },
        }),
    g ? floodZone(g.lat, g.lng) : Promise.resolve({ status: "missing", data: null, source: null, note: "Skipped — address not geocoded." } as Section<never>),
    g ? mlsSubject(g.standardized, g.postal, unit) : Promise.resolve(skipped<MlsSubject>()),
    g ? mlsNearby(g.postal, g.lat, g.lng, g.standardized, unit) : Promise.resolve(skipped<MlsListing[]>()),
  ]);
  const p = parcelRes.parcel.data;

  const salesSrc = db ? await sr1aSource(db) : null;
  const history: Section<DeedRecord[]> =
    db && salesSrc
      ? p && parcelRes.unit.status !== "needs_unit" && parcelRes.unit.status !== "unmatched"
        ? await deedHistory(db, [p.pin], salesSrc).catch((e) => ({ status: "error" as const, data: null, source: salesSrc, error: String(e) }))
        : { status: "missing", data: null, source: salesSrc, note: "Needs the exact tax record (unit) to look up transfers." }
      : noDb("Transfer history");

  const { characteristics, conflicts } = mergeCharacteristics(parcelRes.parcel, history, mlsProperty);

  const kind = p?.kind ?? "other";
  const [market, comps] = await Promise.all([
    db && salesSrc && p
      ? marketStats(db, p.muncode, p.municipality, kind, p.propClass, salesSrc).catch(
          (e) => ({ status: "error", data: null, source: salesSrc, error: String(e) }) as Section<MarketStats>
        )
      : Promise.resolve(db ? ({ status: "missing", data: null, source: salesSrc, note: "No parcel record to place the property." } as Section<MarketStats>) : noDb<MarketStats>("Market statistics")),
    db && salesSrc && p && g
      ? runComps(db, p, g, characteristics, salesSrc).catch(
          (e) => ({ status: "error", data: null, source: salesSrc, error: String(e) }) as Section<CompsResult>
        )
      : Promise.resolve(db ? ({ status: "missing", data: null, source: salesSrc, note: "Needs a matched parcel and location." } as Section<CompsResult>) : noDb<CompsResult>("Comparable sales")),
  ]);

  const deeds = history.data ?? [];
  const indicators = deeds
    .filter((d) => d.nuCode && d.nuLabel)
    .map((d) => `${d.date ?? "Undated"}: ${d.nuLabel}${d.price != null ? ` ($${d.price.toLocaleString()})` : ""}`);

  const dossier: Dossier = {
    version: 1,
    generatedAt: nowIso(),
    input: { address: input.address, unit },
    geocode: geo,
    parcel: parcelRes.parcel,
    unit: parcelRes.unit,
    characteristics,
    conflicts,
    history,
    flood,
    zoning: {
      status: "not_available",
      data: null,
      source: null,
      note: `New Jersey has no statewide zoning dataset — check ${p?.municipality ?? "the municipality"}'s zoning map.`,
    },
    distress: {
      status: history.status === "ok" ? "ok" : history.status,
      data: { indicators },
      source: history.source,
      note: "From non-usable deed codes only. Mortgages, liens and foreclosure filings aren't in the public data — ask the seller, and order a title search before contract.",
    },
    market,
    comps,
    mls: { subject: mlsProperty, nearby: mlsListings },
    insights: { tags: [], risks: [], missing: [], recommended: [] },
    sources: [],
  };
  const withSeller = withSellerFacts(dossier, input.lead);
  withSeller.insights = buildInsights(withSeller, input.lead);
  const all = [geo, parcelRes.parcel, history, flood, market, comps, mlsProperty, mlsListings]
    .map((s) => s.source)
    .filter((s): s is SourceRef => Boolean(s));
  withSeller.sources = [...new Map(all.map((s) => [s.id, s])).values()];
  return withSeller;
}
