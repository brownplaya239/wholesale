import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { inspectionAccess, privateJson } from "@/lib/inspection/access";
import { csvCell, inspectionScore } from "@/lib/inspection/model";
import { listInspection } from "@/lib/inspection/store";

export const runtime = "nodejs";
export async function GET(req: NextRequest) {
  const denied = await inspectionAccess(req); if (denied) return denied;
  const db = await getDb(); if (!db) return privateJson({ error: "Lead database is not connected" }, 503);
  const properties = await listInspection(db);
  const headers = ["lead_id", "inspection_id", "address", "city", "latitude", "longitude", "location_status", "identity_confirmed", "street_review", "lot_review", "imagery_date", "roof_severity", "landscaping_severity", "windows_severity", "exterior_severity", "vacant_appearance_severity", "physical_score_60", "records_complete", "foreclosure_points", "tax_lien_points", "code_points", "public_record_score_40", "distress_score_100", "distress_grade", "prospecting_proxy_30", "reviewed_priority_100", "evidence_source", "evidence_reference", "records_reference", "reviewer", "reviewed_at", "notes", "follow_up"];
  const rows = properties.flatMap((p) => {
    const r = p.review; const s = inspectionScore(p, r, process.env.D4D_GOOGLE_DERIVED_CONTENT_ALLOWED === "true");
    return (p.sourceIds.length ? p.sourceIds : [""]).map((sourceId) => [sourceId, p.id, p.address, p.city, p.lat, p.lng, p.locationStatus, r?.identityConfirmed, r?.streetStatus, r?.lotStatus, r?.imageryDate, r?.roof, r?.landscaping, r?.windows, r?.exterior, r?.vacancy, s.physical, r?.recordsComplete, r?.foreclosure, r?.taxLien, r?.code, s.records, s.score, s.grade, s.proxy, s.priority, r?.evidenceSource, r?.evidenceReference, r?.recordsReference, r?.reviewer, p.reviewedAt, r?.notes, r?.followUp]);
  });
  const body = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  return new NextResponse(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="NJ_Inspection_Review.csv"', "Cache-Control": "private, no-store" } });
}
