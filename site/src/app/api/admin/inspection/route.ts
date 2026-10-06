import { type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { inspectionAccess, privateJson } from "@/lib/inspection/access";
import { propertyInput } from "@/lib/inspection/model";
import { importInspection, listInspection } from "@/lib/inspection/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = await inspectionAccess(req); if (denied) return denied;
  const db = await getDb(); if (!db) return privateJson({ error: "Lead database is not connected" }, 503);
  return privateJson({ properties: await listInspection(db) });
}
export async function POST(req: NextRequest) {
  const denied = await inspectionAccess(req, true); if (denied) return denied;
  if (Number(req.headers.get("content-length")) > 3_500_000) return privateJson({ error: "Import must be smaller than 3.5 MB" }, 413);
  const raw = await req.text(); if (raw.length > 3_500_000) return privateJson({ error: "Import must be smaller than 3.5 MB" }, 413);
  let body: unknown; try { body = JSON.parse(raw); } catch { return privateJson({ error: "Invalid import JSON" }, 400); }
  const parsed = z.object({ rows: z.array(propertyInput).min(1).max(10000) }).safeParse(body);
  if (!parsed.success) return privateJson({ error: "Import needs valid NJ addresses, cities and coordinate pairs", issues: parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })) }, 400);
  const db = await getDb(); if (!db) return privateJson({ error: "Lead database is not connected" }, 503);
  return privateJson({ imported: await importInspection(db, parsed.data.rows) });
}
