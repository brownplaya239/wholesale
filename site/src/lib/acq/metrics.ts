/**
 * Calling funnel + QA aggregation over the call log — pure, so the admin
 * page and the tests share it. Offer/contract/close counts live on GHL
 * opportunities (its pipeline report); this covers the top of the funnel,
 * where caller x county x cohort decides what list to buy next.
 */
import type { CallRow } from "./store";

export type Funnel = {
  dials: number;
  humanAnswered: number;
  conversations: number;
  qualified: number;
  hot: number;
  booked: number;
  dnc: number;
  violations: number;
  possibleAbandoned: number;
  contactRate: number | null;
  qualificationRate: number | null;
  bookingRate: number | null;
  abandonRate: number | null;
};

const QUALIFIED = new Set(["WARM", "HOT", "BOOKED"]);
const rate = (a: number, b: number) => (b ? a / b : null);

export function funnel(calls: CallRow[]): Funnel {
  const out = calls.filter((c) => c.direction !== "inbound");
  const dials = out.length;
  const humanAnswered = out.filter((c) => c.human === true).length;
  const conversations = out.filter((c) => c.conversation).length;
  const qualified = out.filter((c) => QUALIFIED.has(c.dispositionKey ?? "")).length;
  const booked = out.filter((c) => c.dispositionKey === "BOOKED").length;
  const possibleAbandoned = out.filter((c) => c.flags.some((f) => f.code === "possible_abandoned")).length;
  return {
    dials,
    humanAnswered,
    conversations,
    qualified,
    hot: out.filter((c) => c.dispositionKey === "HOT").length,
    booked,
    dnc: out.filter((c) => c.dispositionKey === "DNC").length,
    violations: out.filter((c) => c.flags.some((f) => f.severity === "violation")).length,
    possibleAbandoned,
    contactRate: rate(conversations, dials),
    qualificationRate: rate(qualified, conversations),
    bookingRate: rate(booked, qualified),
    abandonRate: rate(possibleAbandoned, humanAnswered),
  };
}

export function breakdown(calls: CallRow[], dim: string): { key: string; f: Funnel }[] {
  const groups = new Map<string, CallRow[]>();
  for (const c of calls) {
    const k = (dim === "caller" ? c.userId : c.dims[dim]) || "(none)";
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  return [...groups.entries()].map(([key, g]) => ({ key, f: funnel(g) })).sort((a, b) => b.f.dials - a.f.dials);
}

type Qa = { opening: number; tone: number; discovery: number; listening: number; qualification: number; objection_handling: number; control: number; closing: number };
const QA_KEYS: (keyof Qa)[] = ["opening", "tone", "discovery", "listening", "qualification", "objection_handling", "control", "closing"];

export function qaAverage(c: CallRow): number | null {
  const qa = (c.intel as { qa?: Qa | null } | null)?.qa;
  if (!qa) return null;
  const vals = QA_KEYS.map((k) => Number(qa[k])).filter((n) => Number.isFinite(n));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function qaFlags(c: CallRow): string[] {
  const p = (c.intel as { plan?: { alerts?: string[]; qaFlags?: string[] } } | null)?.plan;
  return [...(p?.alerts ?? []), ...(p?.qaFlags ?? [])];
}

/**
 * The weekly listen-list, per caller: 2 successful, 2 ordinary, 1 weak
 * conversation (weak = lowest AI QA score, or anything flagged).
 */
export function weeklySample(calls: CallRow[]): Record<string, { successful: CallRow[]; ordinary: CallRow[]; weak: CallRow[] }> {
  const out: Record<string, { successful: CallRow[]; ordinary: CallRow[]; weak: CallRow[] }> = {};
  for (const c of calls.filter((x) => x.conversation && x.recorded)) {
    const k = c.userId || "(none)";
    out[k] ??= { successful: [], ordinary: [], weak: [] };
  }
  for (const caller of Object.keys(out)) {
    const mine = calls.filter((x) => (x.userId || "(none)") === caller && x.conversation && x.recorded);
    const successful = mine.filter((x) => QUALIFIED.has(x.dispositionKey ?? "")).slice(0, 2);
    const used = new Set(successful.map((x) => x.id));
    const scored = mine.filter((x) => !used.has(x.id)).sort((a, b) => (qaAverage(a) ?? 3) - (qaAverage(b) ?? 3));
    const flagged = scored.filter((x) => qaFlags(x).length);
    const weak = (flagged.length ? flagged : scored).slice(0, 1);
    weak.forEach((x) => used.add(x.id));
    const ordinary = mine.filter((x) => !used.has(x.id) && !QUALIFIED.has(x.dispositionKey ?? "")).slice(0, 2);
    out[caller] = { successful, ordinary, weak };
  }
  return out;
}

export function callerQa(calls: CallRow[]): { caller: string; reviewed: number; avg: number | null; flags: number; disclosureMisses: number }[] {
  const by = new Map<string, CallRow[]>();
  for (const c of calls.filter((x) => x.intel)) by.set(c.userId || "(none)", [...(by.get(c.userId || "(none)") ?? []), c]);
  return [...by.entries()].map(([caller, g]) => {
    const scores = g.map(qaAverage).filter((x): x is number => x !== null);
    return {
      caller,
      reviewed: g.length,
      avg: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      flags: g.filter((x) => qaFlags(x).length).length,
      disclosureMisses: g.filter((x) => qaFlags(x).some((f) => /disclosure/.test(f))).length,
    };
  });
}
