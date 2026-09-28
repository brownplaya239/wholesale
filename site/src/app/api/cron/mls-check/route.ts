import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildDossier } from "@/lib/enrich/dossier";
import { geocode } from "@/lib/enrich/geocode";
import { assignWorkflow } from "@/lib/enrich/insights";
import { enrichedEmail } from "@/lib/leads/reportEmail";
import type { LeadRecord } from "@/lib/leads/store";
import { mlsNearby, mlsSubject, testFeeds, type MlsListing } from "@/lib/enrich/mls";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * MLS feed check without the admin login (Bearer $CRON_SECRET), used to
 * verify a newly added MLS key against live data. No lead data involved.
 *   GET                  -> connection test (endpoint, fields, statuses)
 *   GET ?address=...     -> subject lookup + nearby listings for an address
 *   GET ?address=...&report=1 -> the full report email for that address
 *                           (preview; no lead is created, nothing is sent)
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const address = req.nextUrl.searchParams.get("address")?.slice(0, 200);
  if (address && req.nextUrl.searchParams.get("report")) {
    const facts = { name: "Report Preview", timeline: null, priority: null, condition: null, occupancy: null, createdAt: new Date().toISOString() };
    const d = await buildDossier({ address, unit: null, lead: facts }, await getDb());
    const lead = {
      id: "preview", name: facts.name, phone: "(000) 000-0000", addressOriginal: address, addressCurrent: address, addressUnit: null,
      timeline: null, priority: null, condition: null, occupancy: null, beds: null, baths: null, email: null, notes: null, workflow: null,
    } as unknown as LeadRecord;
    const email = enrichedEmail(lead, d, "new", assignWorkflow(d, facts));
    return NextResponse.json({ ok: true, ...email, pool: d.comps.data?.pool, valuation: d.comps.data?.valuation, photoCheck: d.photoCheck, distress: d.insights.distress });
  }
  const feeds = await testFeeds();
  if (!address) return NextResponse.json({ ok: true, feeds });

  const g = await geocode(address, null);
  if (!g.data) return NextResponse.json({ ok: false, feeds, geocode: g }, { status: 422 });
  const [subject, nearby] = await Promise.all([
    mlsSubject(g.data.standardized, g.data.postal, g.data.unit),
    mlsNearby(g.data.postal, g.data.lat, g.data.lng, g.data.standardized, g.data.unit),
  ]);
  const brief = (l: MlsListing) => ({
    address: l.address,
    unit: l.unit,
    status: l.status,
    listPrice: l.listPrice,
    closePrice: l.closePrice,
    listDate: l.listDate,
    closeDate: l.closeDate,
    beds: l.beds,
    baths: l.baths,
    sqft: l.sqft,
    office: l.office,
    distanceMi: l.distanceMi,
  });
  return NextResponse.json({
    ok: true,
    feeds,
    address: g.data.standardized,
    subject: { status: subject.status, note: subject.note, error: subject.error, beds: subject.data?.beds, baths: subject.data?.baths, records: subject.data?.records.map(brief) },
    nearby: { status: nearby.status, note: nearby.note, error: nearby.error, count: nearby.data?.length ?? 0, listings: nearby.data?.slice(0, 6).map(brief) },
  });
}
