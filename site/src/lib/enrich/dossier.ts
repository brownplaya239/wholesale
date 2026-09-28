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
import { fetchPinAttrs, lookupParcel, muncodesNear, type PinAttrs } from "./parcel";
import { rentcastAvm, rentcastConfigured, rentcastListings, rentcastProperty, rentcastRent } from "./rentcast";
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
  ProviderProperty,
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

export function mergeCharacteristics(
  parcel: Section<ParcelData>,
  history: Section<DeedRecord[]>,
  provider: Section<ProviderProperty>
): { characteristics: Characteristics; conflicts: Conflict[] } {
  const p = parcel.data;
  const deeds = history.data ?? [];
  const rc = provider.data;
  const rcStatus = provider.status === "not_configured" ? "not_configured" : "missing";
  const deedSqft = deeds.find((d) => d.livingSpace)?.livingSpace ?? null;
  const deedYear = deeds.find((d) => d.yearBuilt)?.yearBuilt ?? null;

  const livingSpace = deedSqft
    ? fact(deedSqft, history.source)
    : fact(rc?.squareFootage, provider.source, rcStatus);
  const yearBuilt = p?.yearBuilt
    ? fact(p.yearBuilt, parcel.source)
    : deedYear
      ? fact(deedYear, history.source)
      : fact(rc?.yearBuilt, provider.source, rcStatus);
  const lotAcres = p?.acres
    ? fact(p.acres, parcel.source)
    : fact(rc?.lotSize ? Math.round((rc.lotSize / 43_560) * 100) / 100 : null, provider.source, rcStatus);

  const conflicts: Conflict[] = [];
  const years = [
    p?.yearBuilt ? { value: p.yearBuilt, source: "tax list" } : null,
    deedYear ? { value: deedYear, source: "deed record" } : null,
    rc?.yearBuilt ? { value: rc.yearBuilt, source: "RentCast" } : null,
  ].filter(Boolean) as { value: number; source: string }[];
  if (years.length > 1 && Math.max(...years.map((y) => y.value)) - Math.min(...years.map((y) => y.value)) > 2) {
    conflicts.push({ field: "year built", values: years.map((y) => ({ value: String(y.value), source: y.source })) });
  }
  if (deedSqft && rc?.squareFootage && Math.abs(deedSqft - rc.squareFootage) / deedSqft > 0.1) {
    conflicts.push({
      field: "living area",
      values: [
        { value: `${deedSqft.toLocaleString()} sq ft`, source: "deed record" },
        { value: `${rc.squareFootage.toLocaleString()} sq ft`, source: "RentCast" },
      ],
    });
  }
  if (p?.acres && rc?.lotSize) {
    const rcAcres = rc.lotSize / 43_560;
    if (Math.abs(p.acres - rcAcres) / p.acres > 0.25) {
      conflicts.push({
        field: "lot size",
        values: [
          { value: `${p.acres.toFixed(2)} ac`, source: "parcel map" },
          { value: `${rcAcres.toFixed(2)} ac`, source: "RentCast" },
        ],
      });
    }
  }
  return {
    conflicts,
    characteristics: {
      livingSpace,
      yearBuilt,
      bedrooms: fact(rc?.bedrooms, provider.source, rcStatus),
      bathrooms: fact(rc?.bathrooms, provider.source, rcStatus),
      lotAcres,
      dwellings: fact(p?.dwellings, parcel.source),
    },
  };
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
  const oneLine = `${parsed.base}${unit ? ` Unit ${unit}` : ""}`;

  const [geo, providerProperty] = await Promise.all([geocode(parsed.base, unit), rentcastProperty(oneLine)]);
  const g = geo.data;

  const [parcelRes, flood, listings] = await Promise.all([
    g
      ? lookupParcel(g.lat, g.lng, parsed.base, unit)
      : Promise.resolve({
          parcel: { status: "missing", data: null, source: null, note: "Skipped — address not geocoded." } as Section<ParcelData>,
          unit: { status: "not_applicable" as const, requested: unit },
        }),
    g ? floodZone(g.lat, g.lng) : Promise.resolve({ status: "missing", data: null, source: null, note: "Skipped — address not geocoded." } as Section<never>),
    g
      ? rentcastListings(g.lat, g.lng)
      : Promise.resolve({
          status: rentcastConfigured() ? "missing" : "not_configured",
          data: null,
          source: null,
          note: "Skipped — address not geocoded.",
        } as Section<never>),
  ]);
  const p = parcelRes.parcel.data;

  const salesSrc = db ? await sr1aSource(db) : null;
  const history: Section<DeedRecord[]> =
    db && salesSrc
      ? p && parcelRes.unit.status !== "needs_unit" && parcelRes.unit.status !== "unmatched"
        ? await deedHistory(db, [p.pin], salesSrc).catch((e) => ({ status: "error" as const, data: null, source: salesSrc, error: String(e) }))
        : { status: "missing", data: null, source: salesSrc, note: "Needs the exact tax record (unit) to look up transfers." }
      : noDb("Transfer history");

  const { characteristics, conflicts } = mergeCharacteristics(parcelRes.parcel, history, providerProperty);

  const kind = p?.kind ?? "other";
  const [market, comps, avm, rent] = await Promise.all([
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
    rentcastAvm(oneLine, kind),
    kind === "multifamily" || kind === "condo" || kind === "single_family"
      ? rentcastRent(oneLine, kind)
      : Promise.resolve({ status: "not_available", data: null, source: null, note: "Rent estimate not applicable." } as Section<never>),
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
      note: "From non-usable deed codes only. Mortgage, lien, lis pendens and foreclosure-filing data need a licensed provider (not configured).",
    },
    market,
    comps,
    provider: { property: providerProperty, avm, rent, listings },
    insights: { tags: [], risks: [], missing: [], recommended: [] },
    sources: [],
  };
  dossier.insights = buildInsights(dossier, input.lead);
  const all = [geo, parcelRes.parcel, history, flood, market, comps, providerProperty, avm, rent, listings]
    .map((s) => s.source)
    .filter((s): s is SourceRef => Boolean(s));
  dossier.sources = [...new Map(all.map((s) => [s.id, s])).values()];
  return dossier;
}
