/**
 * Runs enrichment for a stored lead and writes the dossier back to the same
 * record. Never throws — a failure marks the record `failed` for the daily
 * retry and the report's "Re-run" button; lead collection is unaffected.
 */
import { getDb } from "@/lib/db";
import { buildDossier, withSellerFacts } from "@/lib/enrich/dossier";
import { assignWorkflow, buildInsights, type LeadFacts } from "@/lib/enrich/insights";
import type { Dossier } from "@/lib/enrich/types";
import { fanOut } from "./notify";
import { enrichedEmail } from "./reportEmail";
import { claimNotification, getLead, releaseNotification, setEnrichment, type LeadRecord } from "./store";

export type EnrichReason = "new" | "address_changed" | "manual" | "retry";

export function leadFacts(l: LeadRecord): LeadFacts {
  return {
    name: l.name,
    timeline: l.timeline,
    priority: l.priority,
    condition: l.condition,
    occupancy: l.occupancy,
    createdAt: l.createdAt,
    photos: l.photoCount,
    beds: l.beds,
    baths: l.baths,
  };
}

/**
 * The stored dossier brought up to date with the seller's latest answers
 * (beds/baths, timeline… can arrive after enrichment ran). Nothing is
 * re-fetched: seller facts are layered on and insights recomputed.
 */
export function currentDossier(l: LeadRecord, facts: LeadFacts = leadFacts(l)): Dossier | null {
  if (!l.dossier) return null;
  const d = withSellerFacts(l.dossier, facts);
  return { ...d, insights: buildInsights(d, facts) };
}

export async function enrichLead(id: string, opts: { notify: boolean; reason: EnrichReason }): Promise<string> {
  const db = await getDb();
  if (!db) return "no_db";
  const lead = await getLead(db, id);
  if (!lead) return "not_found";
  try {
    await setEnrichment(db, id, { status: "running", startAttempt: true, error: null });
    const dossier = await buildDossier(
      { address: lead.addressCurrent, unit: lead.addressUnit, lead: leadFacts(lead) },
      db
    );
    const workflow = assignWorkflow(dossier, leadFacts(lead));
    const core = [dossier.geocode.status, dossier.parcel.status];
    const status = core.every((s) => s === "ok") ? "complete" : "partial";
    await setEnrichment(db, id, { status, dossier, workflow, error: null });

    if (opts.notify) {
      // One enriched email per address version, however many times this runs.
      const key = `enriched:${lead.addressCurrent.toLowerCase()}|${(lead.addressUnit ?? "").toLowerCase()}`;
      if (await claimNotification(db, id, key)) {
        const fresh = (await getLead(db, id))!;
        // Seller answers that arrived while this ran are folded in.
        const live = currentDossier(fresh) ?? dossier;
        const { subject, text, html } = enrichedEmail(fresh, live, opts.reason, assignWorkflow(live, leadFacts(fresh)));
        const results = await fanOut(subject, text, { stage: "enriched", leadId: id }, `leadId=${id} stage=enriched`, html);
        if (results.length && !results.some((r) => r.ok)) await releaseNotification(db, id, key);
      }
    }
    return status;
  } catch (err) {
    console.error(`ENRICHMENT FAILURE leadId=${id} ${String(err)}`);
    await setEnrichment(db, id, { status: "failed", error: String(err).slice(0, 500) }).catch(() => {});
    return "failed";
  }
}
