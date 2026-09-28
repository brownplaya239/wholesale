/**
 * Rule-based risk flags, missing-information list, and the follow-up
 * workflow assigned to each lead. Deterministic — every flag points at a
 * sourced fact or a seller answer.
 */
import { DISTRESS_NU, ESTATE_NU } from "@/lib/sr1a";
import type { Dossier, Insights } from "./types";

export const CORE_COUNTIES = ["MONMOUTH", "OCEAN", "MIDDLESEX", "SOMERSET", "UNION", "HUDSON", "ESSEX", "MERCER"];

export type LeadFacts = {
  name: string;
  timeline: string | null;
  priority: string | null;
  condition: string | null;
  occupancy: string | null;
  createdAt: string;
  photos?: number;
};

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

function lastNameMatches(sellerName: string, ownerName: string): boolean {
  const last = sellerName.trim().split(/\s+/).at(-1)?.toUpperCase() ?? "";
  return last.length > 1 && ownerName.toUpperCase().includes(last);
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
    if (recentMarketSale) {
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

    if (d.characteristics.livingSpace.value == null && p?.kind !== "land") missing.push("Living area (sq ft)");
    if (d.characteristics.bedrooms.status !== "ok") missing.push("Bedrooms / bathrooms");
    if (d.provider.property.status === "not_configured") missing.push("Full sale & mortgage history (licensed provider not configured)");
    if (d.provider.listings.status === "not_configured") missing.push("Active/pending listings (MLS or licensed feed not connected)");
    missing.push("Mortgage balance, liens and judgments (ask the seller; title search before contract)");
    missing.push("Zoning (no statewide NJ zoning dataset — check the municipal map)");
  } else {
    missing.push("Property enrichment hasn't run yet");
  }
  if (!lead.condition) missing.push("Condition (seller didn't answer)");
  if (!lead.occupancy) missing.push("Occupancy (seller didn't answer)");
  if (!lead.timeline) missing.push("Timeline (seller didn't answer)");
  if (!lead.photos) missing.push("Photos");

  return { tags: [...new Set(tags)], risks, missing, recommended };
}

export function assignWorkflow(d: Dossier | null, lead: LeadFacts, now = new Date()): Workflow {
  const ins = buildInsights(d, lead);
  const t = new Set(ins.tags);
  const track: Workflow["track"] =
    t.has("ADDRESS-UNVERIFIED") || t.has("NEEDS-UNIT") ? "verify" : t.has("HOT") ? "hot" : t.has("LISTING-FIT") ? "listing" : "standard";
  const base: Record<Workflow["track"], string[]> = {
    hot: ["Book a walkthrough within 24 hours", "Deliver both numbers in writing within 24 hours"],
    listing: ["Lead with the listing-net estimate and a CMA", "Present the cash offer as a guaranteed floor"],
    verify: ["Confirm the exact address and unit before valuing", "Then deliver both numbers within 24–48 hours"],
    standard: ["Confirm timeline, condition and occupancy", "Deliver both numbers within 24–48 hours"],
  };
  return {
    track,
    label: TRACK_LABEL[track],
    firstTouch: firstTouch(new Date(lead.createdAt)),
    steps: [...base[track], ...ins.recommended],
    tags: ins.tags,
    updatedAt: now.toISOString(),
  };
}
