/**
 * Investor evidence from the deed file — the comps that matter for a
 * wholesale deal, and the ones that work without an MLS feed:
 *   - flip pairs: bought, resold within 18 months for 25%+ more. The resale
 *     is a renovated price (ARV); the purchase is what an investor paid as-is.
 *   - investor buys: companies (LLC, Inc…) buying houses — the as-is price
 *     level a cash buyer pays.
 * Pure: every number traces to a recorded deed passed in.
 */
import { haversineMi, percentile } from "./comps";
import type { InvestorEvidence, InvestorRange, PropertyKind } from "./types";

export type FlipInput = {
  pin: string;
  location: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  buyDate: string;
  buyPrice: number;
  buyer: string | null;
  buyType: string;
  sellDate: string;
  sellPrice: number;
  livingSpace: number | null;
  yearBuilt: number | null;
};

export type BuyInput = {
  pin: string;
  location: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  date: string;
  price: number;
  buyer: string;
  buyType: string;
  livingSpace: number | null;
  yearBuilt: number | null;
};

type SubjectLite = { kind: PropertyKind; lat: number; lng: number; livingSpace: number | null; yearBuilt: number | null };

const round5k = (v: number, mode: "floor" | "round" | "ceil") => Math[mode](v / 5000) * 5000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Same size band and era as the subject (when both are known). */
function alike(s: SubjectLite, sqft: number | null, yb: number | null): boolean {
  if (s.livingSpace && sqft) {
    const r = sqft / s.livingSpace;
    if (r < 0.65 || r > 1.35) return false;
  }
  if (s.yearBuilt && yb && Math.abs(s.yearBuilt - yb) > 40) return false;
  return true;
}

/** Nearest first, inside 2 mi — widened to 4 mi when fewer than 3 are that close. */
function nearest<T extends { lat: number | null; lng: number | null }>(s: SubjectLite, rows: T[], max: number): { rows: (T & { distanceMi: number })[]; radiusMi: number } {
  const withD = rows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({ ...r, distanceMi: Math.round(haversineMi(s.lat, s.lng, r.lat!, r.lng!) * 100) / 100 }))
    .sort((a, b) => a.distanceMi - b.distanceMi);
  for (const radiusMi of [2, 4]) {
    const inside = withD.filter((r) => r.distanceMi <= radiusMi);
    if (inside.length >= 3 || radiusMi === 4) return { rows: inside.slice(0, max), radiusMi };
  }
  return { rows: [], radiusMi: 4 };
}

/** 25th–75th percentile range, per sq ft × the subject's size when possible. */
export function rangeOf(items: { price: number; livingSpace: number | null }[], subjectSqft: number | null, what: string): InvestorRange | null {
  const ppsf = items.filter((i) => i.livingSpace && i.livingSpace > 300).map((i) => i.price / i.livingSpace!);
  let vals: number[];
  let method: string;
  if (subjectSqft && ppsf.length >= 3) {
    vals = ppsf.sort((a, b) => a - b).map((v) => v * subjectSqft);
    method = `${what} per sq ft (25th–75th percentile) × ${subjectSqft.toLocaleString()} sq ft`;
  } else if (items.length >= 3) {
    vals = items.map((i) => i.price).sort((a, b) => a - b);
    method = `${what} prices (25th–75th percentile)${subjectSqft ? "" : " — subject size unknown, no size adjustment"}`;
  } else {
    return null;
  }
  return {
    low: round5k(percentile(vals, 0.25), "floor"),
    mid: round5k(percentile(vals, 0.5), "round"),
    high: round5k(percentile(vals, 0.75), "ceil"),
    n: vals.length,
    method,
  };
}

export function investorEvidence(s: SubjectLite, flipsIn: FlipInput[], buysIn: BuyInput[], windowDays: number): InvestorEvidence {
  const f = nearest(s, flipsIn.filter((x) => alike(s, x.livingSpace, x.yearBuilt)), 8);
  const b = nearest(s, buysIn.filter((x) => alike(s, x.livingSpace, x.yearBuilt)), 10);
  const flips = f.rows.map((x) => ({
    pin: x.pin,
    address: x.location ?? x.pin,
    municipality: x.municipality,
    buyDate: x.buyDate,
    buyPrice: x.buyPrice,
    buyer: x.buyer,
    buyType: x.buyType,
    sellDate: x.sellDate,
    sellPrice: x.sellPrice,
    daysHeld: days(x.buyDate, x.sellDate),
    livingSpace: x.livingSpace,
    yearBuilt: x.yearBuilt,
    distanceMi: x.distanceMi,
  }));
  const buys = b.rows.map((x) => ({
    pin: x.pin,
    address: x.location ?? x.pin,
    municipality: x.municipality,
    date: x.date,
    price: x.price,
    buyer: x.buyer,
    buyType: x.buyType,
    livingSpace: x.livingSpace,
    yearBuilt: x.yearBuilt,
    distanceMi: x.distanceMi,
  }));
  const sqft = s.kind === "land" ? null : s.livingSpace;
  return {
    flips,
    buys,
    arv: rangeOf(flips.map((x) => ({ price: x.sellPrice, livingSpace: x.livingSpace })), sqft, "Flip resale"),
    // A flip's purchase is an investor buy too (unless it's already listed as one).
    buyPrice: rangeOf(
      [
        ...buys.map((x) => ({ price: x.price, livingSpace: x.livingSpace })),
        ...flips.filter((x) => !buys.some((y) => y.pin === x.pin && y.date === x.buyDate)).map((x) => ({ price: x.buyPrice, livingSpace: x.livingSpace })),
      ],
      sqft,
      "Investor purchase"
    ),
    windowDays,
    radiusMi: Math.max(f.radiusMi, b.radiusMi),
  };
}
