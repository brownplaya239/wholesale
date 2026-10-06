import { type NextRequest } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { inspectionAccess, privateJson } from "@/lib/inspection/access";
import { reviewSchema } from "@/lib/inspection/model";
import { getInspection, saveReview } from "@/lib/inspection/store";

export const runtime = "nodejs";
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const denied = await inspectionAccess(req, true); if (denied) return denied;
  const { id } = await context.params;
  const parsed = z.object({ revision: z.number().int().positive(), review: reviewSchema }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return privateJson({ error: "Review is invalid; use 0–3 severity or leave unknown" }, 400);
  if (parsed.data.review.evidenceSource === "google" && process.env.D4D_GOOGLE_DERIVED_CONTENT_ALLOWED !== "true" && [parsed.data.review.roof, parsed.data.review.landscaping, parsed.data.review.windows, parsed.data.review.exterior, parsed.data.review.vacancy].some((v) => v !== null)) {
    return privateJson({ error: "Saved scoring from Google imagery is not enabled. Use field inspection, owner photos or authorized imagery as the scoring evidence." }, 400);
  }
  const db = await getDb(); if (!db) return privateJson({ error: "Lead database is not connected" }, 503);
  if (!(await getInspection(db, id))) return privateJson({ error: "Property not found" }, 404);
  const property = await saveReview(db, id, parsed.data.revision, parsed.data.review);
  if (!property) return privateJson({ error: "This property changed in another session. Reload before saving." }, 409);
  return privateJson({ property });
}
