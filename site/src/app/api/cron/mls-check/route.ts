import { NextRequest, NextResponse } from "next/server";
import { geocode } from "@/lib/enrich/geocode";
import { mlsNearby, mlsSubject, testFeeds, type MlsListing } from "@/lib/enrich/mls";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * MLS feed check without the admin login (Bearer $CRON_SECRET), used to
 * verify a newly added MLS key against live data. No lead data involved.
 *   GET                  -> connection test (endpoint, fields, statuses)
 *   GET ?address=...     -> subject lookup + nearby listings for an address
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const feeds = await testFeeds();
  const address = req.nextUrl.searchParams.get("address")?.slice(0, 200);
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
