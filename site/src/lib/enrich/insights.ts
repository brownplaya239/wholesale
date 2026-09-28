/**
 * Rule-based risk flags, missing-information list, and the follow-up
 * workflow assigned to each lead. Deterministic — every flag points at a
 * sourced fact or a seller answer.
 */
import { DISTRESS_NU, ESTATE_NU } from "@/lib/sr1a";
import { INDICATOR_LABEL } from "./photoTypes";
import type { Distress, DistressSignal, Dossier, Insights } from "./types";

export const CORE_COUNTIES = ["MONMOUTH", "OCEAN", "MIDDLESEX", "SOMERSET", "UNION", "HUDSON", "ESSEX", "MERCER"];

export type LeadFacts = {
  name: string;
  timeline: string | null;
  priority: string | null;
  condition: string | null;
  occupancy: string | null;
  createdAt: string;
  photos?: number;
  notes?: string | null;
  /** Seller-reported on the thank-you page, e.g. "3", "2.5", "5+". */
  beds?: string | null;
  baths?: string | null;
};

const CURRENTLY_LISTED = new Set(["Active", "Active Under Contract", "Pending", "Coming Soon", "Hold"]);
const ENDED = new Set(["Expired", "Withdrawn", "Canceled", "Cancelled"]);

export type Workflow = {
  track: "hot" | "standard" | "listing" | "verify";
  label: string;
  firstTouch: string;
  steps: string[];
  tags: string[];
  updatedAt: string;
};

const TRACK_LABEL: Record<Workflow["track"], string> = {
  hot: "Hot — speed & certainty",
  listing: "Listing fit — highest net",
  verify: "Verify property first",
  standard: "Standard follow-up",
};

/** Hour 0–23 in New Jersey time. */
export function njHour(at: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(at));
}

export function firstTouch(at: Date): string {
  const h = njHour(at);
  return h >= 8 && h < 21
    ? "Call within 5 minutes; if no answer, text right away"
    : "Arrived outside 8 AM–9 PM — text at 8:00 AM ET, call by 9:00 AM ET";
}

export function lastNameMatches(sellerName: string, ownerName: string): boolean {
  const last = sellerName.trim().split(/\s+/).at(-1)?.toUpperCase() ?? "";
  return last.length > 1 && ownerName.toUpperCase().includes(last);
}

/** Seller notes that signal distress. */
const NOTE_FLAGS: { re: RegExp; label: string; weight: 1 | 2; kind: DistressSignal["kind"] }[] = [
  { re: /foreclos|lis pendens|sheriff|auction/i, label: "foreclosure", weight: 2, kind: "situation" },
  { re: /behind on|missed (mortgage )?payments?|late on (the |my )?mortgage|\bdefault/i, label: "behind on payments", weight: 2, kind: "situation" },
  { re: /bankrupt/i, label: "bankruptcy", weight: 2, kind: "situation" },
  { re: /back taxes|tax (sale|lien)|\bliens?\b|judgment/i, label: "liens / back taxes", weight: 2, kind: "situation" },
  { re: /probate|passed away|inherit|executor|deceased|\bestate\b/i, label: "estate / inherited", weight: 2, kind: "situation" },
  { re: /fire|flood(ed|ing)|water damage|mold|hoard|condemn|code violation|foundation|roof (leak|damage)|asbestos|gutted/i, label: "physical damage", weight: 2, kind: "property" },
  { re: /divorc|separat/i, label: "divorce", weight: 1, kind: "situation" },
  { re: /evict|problem tenant|tenant (won't|not) pay/i, label: "tenant problems", weight: 1, kind: "situation" },
  { re: /relocat|job (loss|transfer)|moving out of state/i, label: "relocation", weight: 1, kind: "situation" },
];

/**
 * Distress at a glance: every signal points at a fact or a seller answer.
 * Physical (the house) vs. situation (the seller). Tax delinquency and
 * pre-foreclosure filings aren't in the public data, so "none" means none
 * seen — the Street View photo is the other half of the check.
 */
export function assessDistress(d: Dossier | null, lead: LeadFacts): Distress {
  const signals: DistressSignal[] = [];
  const add = (label: string, weight: DistressSignal["weight"], kind: DistressSignal["kind"]) => signals.push({ label, weight, kind });
  if (lead.condition === "Needs major repairs" || lead.condition === "Needs a full renovation") add(`Seller: "${lead.condition}"`, 2, "property");
  if (lead.occupancy === "Vacant") add("Vacant (seller-reported)", 2, "property");
  if (lead.occupancy === "Tenant-occupied") add("Tenant-occupied — possible tired landlord", 1, "situation");
  if (lead.timeline === "ASAP") add("Needs to sell ASAP", 1, "situation");
  for (const f of NOTE_FLAGS) if (lead.notes && f.re.test(lead.notes)) add(`Seller's notes mention ${f.label}`, f.weight, f.kind);
  if (d) {
    const p = d.parcel.data;
    const deeds = d.history.data ?? [];
    if (deeds[0]?.nuCode && ESTATE_NU.has(Number(deeds[0].nuCode))) add(`Inherited — last transfer by executor (${deeds[0].date})`, 2, "situation");
    if (deeds.some((x) => x.nuCode && DISTRESS_NU.has(Number(x.nuCode)))) add("Deed history: sheriff's, foreclosure, short or lien sale", 2, "situation");
    if (p?.owner.absentee && p.kind !== "land") add("Absentee owner — tax bills mail elsewhere", 1, "situation");
    const imp = p?.assessed.improvement;
    const net = p?.assessed.net;
    if (p && p.kind !== "land" && imp != null && net && net > 0 && imp / net < 0.2) {
      add(`Building assessed at only ${Math.round((imp / net) * 100)}% of the property's value — possible teardown or deferred upkeep`, 1, "property");
    }
    if (d.flood.data?.sfha) add(`Flood zone ${d.flood.data.zone}`, 1, "property");
    const active = d.mls?.subject.data?.activeListing;
    if (active?.daysOnMarket != null && active.daysOnMarket >= 90) add(`Listed ${active.daysOnMarket} days without selling`, 1, "situation");
    if (active?.originalListPrice && active.listPrice && active.originalListPrice > active.listPrice * 1.03) {
      add(`Price cut ${Math.round((1 - active.listPrice / active.originalListPrice) * 100)}% since listing`, 1, "situation");
    }
    const ended = (d.mls?.subject.data?.records ?? []).find(
      (r) => r.status && ENDED.has(r.status) && r.modified && Date.now() - Date.parse(r.modified) < 365 * 86_400_000
    );
    if (ended && !active) add(`MLS listing ${ended.status!.toLowerCase()} without selling`, 1, "situation");

    // What the pictures show (Claude photo check). Low-confidence findings
    // are shown in the email but never scored.
    const pc = d.photoCheck?.status === "ok" ? d.photoCheck.data : null;
    if (pc) {
      const firm = pc.findings.filter((f) => f.confidence !== "low" && f.indicator !== "renovation_in_progress");
      const what = [...new Set(firm.map((f) => INDICATOR_LABEL[f.indicator]))].join(", ");
      const old = pc.streetViewDate && Date.now() - Date.parse(`${pc.streetViewDate}-01`) > 3 * 365 * 86_400_000 ? ` — Street View from ${pc.streetViewDate.slice(0, 4)}` : "";
      if (pc.overall === "severe") add(`Photos: ${what || pc.summary}${old}`, 4, "property");
      else if (pc.overall === "moderate") add(`Photos: ${what || pc.summary}${old}`, 2, "property");
      else if (pc.overall === "minor" && what) add(`Photos, cosmetic: ${what}`, 0, "property");
      if (pc.findings.some((f) => f.indicator === "renovation_in_progress" && f.confidence !== "low")) add("Photos: renovation in progress", 0, "property");
      if (pc.street_view.house_number === "different") add("Street View may show the wrong house — the visible number doesn't match", 0, "property");
    }
  }
  signals.sort((a, b) => b.weight - a.weight);
  const score = signals.reduce((n, s) => n + s.weight, 0);
  return { level: score >= 4 ? "high" : score >= 2 ? "some" : score === 1 ? "low" : "none", score, signals };
}

export function buildInsights(d: Dossier | null, lead: LeadFacts): Insights {
  const tags: string[] = [];
  const risks: string[] = [];
  const missing: string[] = [];
  const recommended: string[] = [];

  if (lead.timeline === "ASAP" || lead.priority === "Speed & certainty") tags.push("HOT");
  if (lead.priority === "Highest net proceeds") tags.push("LISTING-FIT");

  if (d) {
    const g = d.geocode.data;
    const p = d.parcel.data;
    const mlsRecords = d.mls?.subject.data?.records ?? [];
    const active = mlsRecords.find((r) => r.status && CURRENTLY_LISTED.has(r.status));
    if (active) {
      // NJ REC: never interfere with another broker's exclusive listing.
      tags.push("LISTED-ELSEWHERE");
      risks.push(
        `Currently ${active.status === "Hold" ? "on hold" : active.status} in ${active.feed}${active.office ? ` with ${active.office}` : ""}${active.listDate ? ` since ${active.listDate}` : ""}${active.listPrice ? ` at $${active.listPrice.toLocaleString()}` : ""}. If that isn't your listing, it's an exclusive agreement with another broker — don't interfere; confirm its status and expiration before discussing a sale or listing.`
      );
    }
    const ended = mlsRecords.find(
      (r) => r.status && ENDED.has(r.status) && r.modified && Date.now() - Date.parse(r.modified) < 365 * 86_400_000
    );
    if (ended && !active) {
      tags.push("EXPIRED-LISTING");
      risks.push(
        `MLS listing ${ended.status!.toLowerCase()} (${ended.modified!.slice(0, 10)})${ended.listPrice ? ` at $${ended.listPrice.toLocaleString()}` : ""}${ended.daysOnMarket ? ` after ${ended.daysOnMarket} days` : ""}${ended.office ? ` with ${ended.office}` : ""} — it didn't sell; ask what happened.`
      );
    }
    if (!g || g.match === "not_found" || g.match === "low_confidence") {
      tags.push("ADDRESS-UNVERIFIED");
      risks.push("Address couldn't be matched confidently to NJ address records — confirm it on the call.");
    } else if (g.match === "interpolated") {
      risks.push("Address location is interpolated along the street, not an exact address point.");
    }
    if (d.parcel.status !== "ok") risks.push("No tax-parcel record found at this location — property facts are unverified.");
    if (d.unit.status === "needs_unit") {
      tags.push("NEEDS-UNIT");
      risks.push("Condo complex — the seller's unit number is needed to identify the exact tax record.");
    } else if (d.unit.status === "unmatched") {
      tags.push("NEEDS-UNIT");
      risks.push(`Unit ${d.unit.requested} didn't match a single tax record — confirm the unit.`);
    }
    if (p) {
      if (p.kind === "condo") {
        tags.push("CONDO");
        recommended.push("Ask about HOA dues, special assessments, and rental restrictions.");
      }
      if (p.kind === "multifamily") {
        tags.push("MULTIFAMILY");
        recommended.push(`Get the rent roll and lease terms${p.dwellings ? ` (${p.dwellings} dwellings on the tax list)` : ""}.`);
      }
      if (p.kind === "land") {
        tags.push("LAND");
        risks.push("Vacant land — value depends on zoning, utilities and buildability, which aren't in the data.");
      }
      if (p.kind === "other") risks.push(`Tax class ${p.propClass} (${p.propClassLabel}) — not a standard residential property.`);
      if (p.owner.absentee) {
        tags.push("ABSENTEE-OWNER");
        risks.push(
          p.kind === "land"
            ? `Tax bills mail to ${p.owner.mailing} — owner lives elsewhere.`
            : `Tax bills mail to ${p.owner.mailing} — absentee owner; confirm occupancy (tenant or vacant).`
        );
      }
      if (p.owner.name && !lastNameMatches(lead.name, p.owner.name)) {
        risks.push(`Seller's name doesn't match the owner of record (${p.owner.name}) — confirm authority to sell.`);
      }
      if (!CORE_COUNTIES.includes(p.county.toUpperCase())) {
        tags.push("OUT-OF-AREA");
        risks.push(`${p.county} County is outside the core service counties.`);
      }
      const yb = d.characteristics.yearBuilt.value;
      if (yb && yb < 1978 && p.kind !== "land") {
        tags.push("PRE-1978");
        risks.push(`Built ${yb} (before 1978) — lead-based paint disclosure applies.`);
      }
    }
    const f = d.flood.data;
    if (f?.sfha) {
      tags.push("FLOOD-ZONE");
      risks.push(`FEMA Special Flood Hazard Area (zone ${f.zone}${f.baseFloodElevation != null ? `, BFE ${f.baseFloodElevation} ft` : ""}) — flood insurance required for financed buyers.`);
      recommended.push("Ask about flood insurance cost and any past flood damage.");
    }
    const deeds = d.history.data ?? [];
    const latest = deeds[0];
    const recentMarketSale = deeds.find(
      (x) => x.usable && x.price && x.date && Date.now() - Date.parse(x.date) < 365 * 86_400_000
    );
    const own = d.comps.data?.valuation?.ownSale;
    if (own) {
      risks.push(
        own.inRange
          ? `This property sold on ${own.date} for $${own.price.toLocaleString()} (${own.source}) — consistent with the comp range.`
          : `This property sold on ${own.date} for $${own.price.toLocaleString()} (${own.source}) — ${own.price < d.comps.data!.valuation!.low ? "below" : "above"} the comp range. Lean on that sale; the range's confidence was lowered.`
      );
    } else if (recentMarketSale) {
      risks.push(
        `Arm's-length sale of this property on ${recentMarketSale.date} for $${recentMarketSale.price!.toLocaleString()} — the strongest value evidence; reconcile the comp range against it.`
      );
    }
    if (latest?.nuCode && ESTATE_NU.has(Number(latest.nuCode))) {
      tags.push("ESTATE-HISTORY");
      risks.push(`Last transfer (${latest.date}) was by an executor/administrator — an estate sale.`);
    }
    if (deeds.some((x) => x.nuCode && DISTRESS_NU.has(Number(x.nuCode)))) {
      tags.push("DISTRESS-HISTORY");
      risks.push("Deed history includes a sheriff's, foreclosure-related, short, or lien-affected sale.");
    }
    for (const c of d.conflicts) {
      risks.push(`Records disagree on ${c.field}: ${c.values.map((v) => `${v.value} (${v.source})`).join(" vs ")}.`);
    }
    const v = d.comps.data?.valuation;
    if (!v) risks.push("No comparable-sales value range could be computed.");
    else if (v.confidence === "low") risks.push("Comparable sales are sparse or distant — value range is low-confidence.");

    if (p && !p.owner.name) {
      // The state parcel file withholds owner names, so authority to sell can't be checked from data.
      missing.push("Owner of record — names are withheld from the state parcel data; confirm the seller is on the deed");
    }
    if (d.characteristics.livingSpace.value == null && p?.kind !== "land") missing.push("Living area (sq ft)");
    const mlsOff = !d.mls || d.mls.subject.status === "not_configured";
    if (d.characteristics.bedrooms.status !== "ok" && p?.kind !== "land") {
      missing.push(
        mlsOff ? "Bedrooms / bathrooms (connect the MLS feed, or ask the seller)" : "Bedrooms / bathrooms (no MLS record — ask the seller)"
      );
    }
    if (mlsOff) missing.push("Active/pending listings nearby (connect the MLS feed)");
    missing.push("Mortgage balance, liens and judgments (ask the seller; title search before contract)");
    missing.push("Zoning (no statewide NJ zoning dataset — check the municipal map)");
  } else {
    missing.push("Property enrichment hasn't run yet");
  }
  if (!lead.condition) missing.push("Condition (seller didn't answer)");
  if (!lead.occupancy) missing.push("Occupancy (seller didn't answer)");
  if (!lead.timeline) missing.push("Timeline (seller didn't answer)");
  if (!lead.photos) missing.push("Photos");

  const distress = assessDistress(d, lead);
  if (distress.level === "high") tags.push("DISTRESSED");
  return { tags: [...new Set(tags)], risks, missing, recommended, distress };
}

export function assignWorkflow(d: Dossier | null, lead: LeadFacts, now = new Date()): Workflow {
  const ins = buildInsights(d, lead);
  const t = new Set(ins.tags);
  const track: Workflow["track"] =
    t.has("ADDRESS-UNVERIFIED") || t.has("NEEDS-UNIT") || t.has("LISTED-ELSEWHERE")
      ? "verify"
      : t.has("HOT")
        ? "hot"
        : t.has("LISTING-FIT")
          ? "listing"
          : "standard";
  const base: Record<Workflow["track"], string[]> = {
    hot: ["Book a walkthrough within 24 hours", "Deliver both numbers in writing within 24 hours"],
    listing: ["Lead with the listing-net estimate and a CMA", "Present the cash offer as a guaranteed floor"],
    verify: ["Confirm the exact address and unit before valuing", "Then deliver both numbers within 24–48 hours"],
    standard: ["Confirm timeline, condition and occupancy", "Deliver both numbers within 24–48 hours"],
  };
  let steps = base[track];
  if (t.has("LISTED-ELSEWHERE")) {
    // NJ REC: another broker's exclusive listing is off-limits while active.
    const listing = [
      "Before anything else: confirm the listing agreement's status and expiration date",
      "While it's listed with another broker, don't negotiate with the seller directly or discuss re-listing — any offer goes through their listing agent",
    ];
    steps = t.has("ADDRESS-UNVERIFIED") || t.has("NEEDS-UNIT") ? [...listing, base.verify[0]] : listing;
  }
  return {
    track,
    label: TRACK_LABEL[track],
    firstTouch: firstTouch(new Date(lead.createdAt)),
    steps: [...steps, ...ins.recommended],
    tags: ins.tags,
    updatedAt: now.toISOString(),
  };
}
