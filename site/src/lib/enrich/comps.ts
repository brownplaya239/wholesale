/**
 * Property-type-aware comparable-sales selection and the preliminary value
 * range. Pure functions: every number traces back to a recorded sale passed
 * in — nothing is generated. Tested in tests/comps.test.mts.
 */
import type { Comp, CompsResult, PropertyKind, Valuation } from "./types";

export type Subject = {
  kind: PropertyKind;
  pin: string;
  muncode: string;
  block: string;
  lot: string;
  lat: number | null;
  lng: number | null;
  livingSpace: number | null;
  yearBuilt: number | null;
  acres: number | null;
  dwellings: number | null;
};

export type CompCandidate = {
  pin: string;
  muncode: string;
  block: string;
  lot: string;
  qual: string;
  saleDate: string;
  price: number;
  livingSpace: number | null;
  yearBuilt: number | null;
  location: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  dwellings: number | null;
  acres: number | null;
};

type Step = { days: number; miles: number | null; sameBuilding?: boolean; label: string };

export function stepsFor(kind: PropertyKind): Step[] {
  const std: Step[] = [
    { days: 180, miles: 0.5, label: "180 days, 0.5 mi" },
    { days: 180, miles: 1, label: "180 days, 1 mi" },
    { days: 365, miles: 1, label: "365 days, 1 mi" },
    { days: 365, miles: 2, label: "365 days, 2 mi" },
    { days: 730, miles: 3, label: "730 days, 3 mi" },
  ];
  if (kind === "condo") {
    return [
      { days: 180, miles: null, sameBuilding: true, label: "same building, 180 days" },
      { days: 365, miles: null, sameBuilding: true, label: "same building, 365 days" },
      ...std,
    ];
  }
  if (kind === "land") {
    return std.map((s) => ({ ...s, miles: (s.miles ?? 1) * 2, label: s.label.replace(/[\d.]+ mi/, `${(s.miles ?? 1) * 2} mi`) }));
  }
  return std;
}

export function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const daysBetween = (a: string, b: Date) => (b.getTime() - Date.parse(a)) / 86_400_000;

function sameBuilding(s: Subject, c: CompCandidate): boolean {
  return c.muncode === s.muncode && c.block === s.block && c.lot === s.lot;
}

/** Type/size similarity gates — a comp must be the same kind of property. */
export function isSimilar(s: Subject, c: CompCandidate): boolean {
  if (s.kind === "single_family" && (c.qual !== "" || (c.dwellings ?? 1) >= 2)) return false;
  if (s.kind === "condo" && !/^C/i.test(c.qual)) return false;
  if (s.kind === "multifamily") {
    if ((c.dwellings ?? 0) < 2) return false;
    if (s.dwellings && c.dwellings && Math.abs(c.dwellings - s.dwellings) > Math.max(1, s.dwellings * 0.5)) return false;
  }
  if (s.kind === "land" && s.acres && c.acres && (c.acres < s.acres / 3 || c.acres > s.acres * 3)) return false;
  if (s.kind !== "land" && s.livingSpace && c.livingSpace) {
    const r = c.livingSpace / s.livingSpace;
    if (r < 0.65 || r > 1.35) return false;
  }
  if (s.yearBuilt && c.yearBuilt && s.kind !== "land" && Math.abs(c.yearBuilt - s.yearBuilt) > 40) return false;
  return true;
}

function describe(s: Subject, c: CompCandidate, distanceMi: number | null, same: boolean): string[] {
  const d: string[] = [];
  if (same) d.push("Same building");
  if (distanceMi != null) d.push(`${distanceMi < 0.1 ? "<0.1" : distanceMi.toFixed(1)} mi away`);
  if (s.livingSpace && c.livingSpace) {
    const diff = c.livingSpace - s.livingSpace;
    if (Math.abs(diff) >= 50) d.push(`${diff > 0 ? "+" : "−"}${Math.abs(diff).toLocaleString()} sq ft`);
    else d.push("Similar size");
  }
  if (s.yearBuilt && c.yearBuilt) {
    const diff = c.yearBuilt - s.yearBuilt;
    if (Math.abs(diff) >= 5) d.push(`Built ${Math.abs(diff)} yrs ${diff > 0 ? "newer" : "older"}`);
  }
  if (s.kind === "multifamily" && c.dwellings) d.push(`${c.dwellings} units`);
  if (s.kind === "land" && s.acres && c.acres) d.push(`${c.acres.toFixed(2)} ac vs ${s.acres.toFixed(2)} ac`);
  return d;
}

function scoreOf(s: Subject, c: CompCandidate, distanceMi: number | null, maxMi: number, ageDays: number, same: boolean): number {
  let score = 0;
  score += distanceMi != null ? (distanceMi / Math.max(maxMi, 0.5)) * 30 : 20;
  if (s.livingSpace && c.livingSpace) score += (Math.abs(c.livingSpace - s.livingSpace) / s.livingSpace) * 40;
  else score += 10;
  if (s.yearBuilt && c.yearBuilt) score += (Math.abs(c.yearBuilt - s.yearBuilt) / 30) * 15;
  score += (ageDays / 730) * 15;
  if (same) score -= 25;
  // Taxes and schools follow the municipality, not the mile radius.
  if (c.muncode !== s.muncode) score += 8;
  if (s.kind === "multifamily" && s.dwellings && c.dwellings && c.dwellings !== s.dwellings) score += 10;
  if (s.kind === "land" && s.acres && c.acres) score += Math.abs(Math.log(c.acres / s.acres)) * 15;
  return Math.round(score * 10) / 10;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const round5k = (v: number, mode: "floor" | "round" | "ceil") => Math[mode](v / 5000) * 5000;

export function valuate(s: Subject, comps: Comp[], windowDays: number, radiusMi: number | null): Valuation | null {
  if (comps.length === 0) return null;
  const q = (vals: number[]) => {
    const v = [...vals].sort((a, b) => a - b);
    return { p25: percentile(v, 0.25), p50: percentile(v, 0.5), p75: percentile(v, 0.75) };
  };
  let method: string;
  let lo: number;
  let mid: number;
  let hi: number;
  const ppsf = comps.map((c) => c.ppsf).filter((v): v is number => v != null && v > 0);
  const perAcre = comps.map((c) => c.pricePerAcre).filter((v): v is number => v != null && v > 0);
  const perUnit = comps.map((c) => c.pricePerUnit).filter((v): v is number => v != null && v > 0);
  // Building lots sell as "a buildable lot", not by the acre — per-acre
  // pricing only for larger tracts (comps are already acreage-matched).
  if (s.kind === "land" && s.acres && s.acres >= 2 && perAcre.length >= 3) {
    const r = q(perAcre);
    [lo, mid, hi] = [r.p25 * s.acres, r.p50 * s.acres, r.p75 * s.acres];
    method = `Comp price per acre (25th–75th percentile) × ${s.acres.toFixed(2)} acres`;
  } else if (s.kind === "multifamily" && s.dwellings && s.dwellings >= 2 && perUnit.length >= 3) {
    const r = q(perUnit);
    [lo, mid, hi] = [r.p25 * s.dwellings, r.p50 * s.dwellings, r.p75 * s.dwellings];
    method = `Comp price per unit (25th–75th percentile) × ${s.dwellings} units`;
  } else if (s.livingSpace && ppsf.length >= 3 && s.kind !== "land") {
    const r = q(ppsf);
    [lo, mid, hi] = [r.p25 * s.livingSpace, r.p50 * s.livingSpace, r.p75 * s.livingSpace];
    method = `Comp price per sq ft (25th–75th percentile) × ${s.livingSpace.toLocaleString()} sq ft`;
  } else {
    const r = q(comps.map((c) => c.price));
    [lo, mid, hi] = [r.p25, r.p50, r.p75];
    method =
      s.kind === "land"
        ? "Comp lot sale prices (25th–75th percentile), lots of similar acreage"
        : "Comp sale prices (25th–75th percentile) — subject size unknown, no size adjustment";
  }

  let pts = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    pts += points;
    reasons.push(reason);
  };
  if (comps.length >= 5) add(2, `${comps.length} comparable sales`);
  else if (comps.length >= 3) add(1, `${comps.length} comparable sales`);
  else add(0, `Only ${comps.length} comparable sale${comps.length === 1 ? "" : "s"}`);
  if (windowDays <= 180) add(2, "All within 180 days");
  else if (windowDays <= 365) add(1, "Lookback expanded to 365 days");
  else add(0, `Lookback expanded to ${windowDays} days`);
  const dists = comps.map((c) => c.distanceMi).filter((d): d is number => d != null).sort((a, b) => a - b);
  const medDist = dists.length ? percentile(dists, 0.5) : null;
  if (comps.some((c) => c.sameBuilding)) add(2, "Includes same-building sales");
  else if (medDist != null && medDist <= 0.5) add(2, "Median comp within 0.5 mi");
  else if (medDist != null && medDist <= 1) add(1, "Median comp within 1 mi");
  else if (medDist != null) add(0, `Median comp ${medDist.toFixed(1)} mi away`);
  if (/per (sq ft|acre|unit)|similar acreage/.test(method)) pts += 1;
  else add(0, "No size adjustment possible");
  if (s.livingSpace && s.kind !== "land") {
    const gaps = comps
      .filter((c) => c.livingSpace)
      .map((c) => Math.abs((c.livingSpace as number) - (s.livingSpace as number)) / (s.livingSpace as number))
      .sort((a, b) => a - b);
    if (gaps.length && percentile(gaps, 0.5) > 0.2) {
      pts -= 2;
      reasons.push(`Comps differ in size by ~${Math.round(percentile(gaps, 0.5) * 100)}% — per-sq-ft scaling is less reliable`);
    }
  }
  const spread = hi / Math.max(lo, 1);
  if (spread <= 1.25) add(1, "Tight price spread");
  else if (spread > 1.6) add(-2, "Wide price spread among comps");
  if (radiusMi && radiusMi > 2) add(0, `Search radius expanded to ${radiusMi} mi`);

  return {
    low: round5k(lo, "floor"),
    mid: round5k(mid, "round"),
    high: round5k(hi, "ceil"),
    method,
    // "High" needs both a strong score and at least five sales behind it.
    confidence: pts >= 6 && comps.length >= 5 ? "high" : pts >= 3 ? "medium" : "low",
    reasons,
  };
}

export function selectComps(s: Subject, candidates: CompCandidate[], now = new Date()): CompsResult {
  const steps = stepsFor(s.kind);
  const trail: CompsResult["steps"] = [];
  const toComp = (c: CompCandidate, distanceMi: number | null, maxMi: number): Comp => {
    const same = sameBuilding(s, c);
    const ageDays = daysBetween(c.saleDate, now);
    return {
      pin: c.pin,
      address: c.location ?? c.pin,
      municipality: c.municipality,
      saleDate: c.saleDate,
      price: c.price,
      livingSpace: c.livingSpace,
      ppsf: c.livingSpace && c.livingSpace > 300 ? Math.round(c.price / c.livingSpace) : null,
      yearBuilt: c.yearBuilt,
      distanceMi: distanceMi == null ? null : Math.round(distanceMi * 100) / 100,
      dwellings: c.dwellings,
      acres: c.acres,
      pricePerUnit: c.dwellings && c.dwellings >= 2 ? Math.round(c.price / c.dwellings) : null,
      pricePerAcre: c.acres && c.acres >= 0.05 ? Math.round(c.price / c.acres) : null,
      sameBuilding: same,
      differences: describe(s, c, distanceMi, same),
      score: scoreOf(s, c, distanceMi, maxMi, ageDays, same),
      lat: c.lat,
      lng: c.lng,
    };
  };

  const picked = new Map<string, Comp>();
  let windowDays = 0;
  let radiusMi: number | null = null;
  for (const step of steps) {
    const qualifying: Comp[] = [];
    for (const c of candidates) {
      if (c.pin === s.pin || !isSimilar(s, c)) continue;
      if (daysBetween(c.saleDate, now) > step.days) continue;
      const dist =
        s.lat != null && s.lng != null && c.lat != null && c.lng != null ? haversineMi(s.lat, s.lng, c.lat, c.lng) : null;
      if (step.sameBuilding) {
        if (!sameBuilding(s, c)) continue;
      } else if (dist == null || dist > (step.miles ?? 0)) {
        continue;
      }
      qualifying.push(toComp(c, dist, step.miles ?? 1));
    }
    trail.push({ label: step.label, qualifying: qualifying.length });
    for (const q of qualifying) if (!picked.has(q.pin)) picked.set(q.pin, q);
    windowDays = Math.max(windowDays, step.days);
    if (step.miles) radiusMi = Math.max(radiusMi ?? 0, step.miles);
    if (picked.size >= 3) break;
  }
  const comps = [...picked.values()].sort((a, b) => a.score - b.score).slice(0, 6);
  // Only claim the lookback/radius actually needed by the comps kept.
  const usedDays = comps.length ? Math.max(...comps.map((c) => Math.ceil(daysBetween(c.saleDate, now)))) : windowDays;
  const window = steps.find((st) => st.days >= usedDays)?.days ?? windowDays;
  const usedMi = comps.some((c) => c.distanceMi != null) ? Math.max(...comps.map((c) => c.distanceMi ?? 0)) : null;
  const usedRadius = usedMi == null ? radiusMi : Math.ceil(usedMi * 2) / 2;
  return {
    kind: s.kind,
    comps,
    steps: trail,
    windowDays: window,
    radiusMi: usedRadius,
    valuation: comps.length ? valuate(s, comps, window, usedRadius) : null,
    note: comps.length < 3 ? "Fewer than 3 comparable sales found even after expanding the search." : undefined,
  };
}
