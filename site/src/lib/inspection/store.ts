import { createHash } from "node:crypto";
import { iso, type Db } from "@/lib/db";
import { addressKey, type InspectionProperty, type InspectionReview, type PropertyInput } from "./model";

type Row = { id: string; data: PropertyInput; review: InspectionReview | null; revision: number; reviewed_at: unknown };
const record = (r: Row): InspectionProperty => ({ ...r.data, id: r.id, review: r.review, revision: Number(r.revision), reviewedAt: iso(r.reviewed_at) });

export async function listInspection(db: Db): Promise<InspectionProperty[]> {
  return (await db.q<Row>(`SELECT id, data, review, revision, reviewed_at FROM inspection_properties ORDER BY created_at, id LIMIT 10000`)).map(record);
}
export async function getInspection(db: Db, id: string): Promise<InspectionProperty | null> {
  const rows = await db.q<Row>(`SELECT id, data, review, revision, reviewed_at FROM inspection_properties WHERE id = $1`, [id]);
  return rows[0] ? record(rows[0]) : null;
}

export async function importInspection(db: Db, rows: PropertyInput[]) {
  const grouped = new Map<string, PropertyInput>();
  for (const p of rows) {
    const key = addressKey(p.address, p.city); const old = grouped.get(key);
    grouped.set(key, { ...(old ?? p), ...(p.locationStatus === "matched" || !old ? p : {}), sourceIds: [...new Set([...(old?.sourceIds ?? []), ...p.sourceIds])] });
  }
  const packed = [...grouped].map(([key, data]) => ({ id: "d4d_" + createHash("sha256").update(key).digest("hex").slice(0, 24), data }));
  // One SQL statement is atomic; reimports preserve reviews and resolved locations.
  await db.q(`INSERT INTO inspection_properties (id, data)
    SELECT id, data FROM jsonb_to_recordset($1::jsonb) AS incoming(id text, data jsonb)
    ON CONFLICT (id) DO UPDATE SET
      data = inspection_properties.data || jsonb_strip_nulls(EXCLUDED.data) ||
        CASE WHEN inspection_properties.data->>'locationStatus' = 'matched' AND EXCLUDED.data->>'locationStatus' <> 'matched'
          THEN jsonb_build_object('lat', inspection_properties.data->'lat', 'lng', inspection_properties.data->'lng', 'locationStatus', inspection_properties.data->'locationStatus',
            'pin', inspection_properties.data->'pin', 'objectId', inspection_properties.data->'objectId', 'county', inspection_properties.data->'county',
            'block', inspection_properties.data->'block', 'lot', inspection_properties.data->'lot', 'qualifier', inspection_properties.data->'qualifier',
            'tenureConflict', COALESCE((inspection_properties.data->>'tenureConflict')::boolean, false) OR COALESCE((EXCLUDED.data->>'tenureConflict')::boolean, false))
          WHEN EXCLUDED.data->>'lat' IS NULL THEN jsonb_build_object('lat', inspection_properties.data->'lat', 'lng', inspection_properties.data->'lng', 'locationStatus', inspection_properties.data->'locationStatus')
          ELSE '{}'::jsonb END ||
        jsonb_build_object('sourceIds', COALESCE((SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements(COALESCE(inspection_properties.data->'sourceIds','[]'::jsonb) || (EXCLUDED.data->'sourceIds')) AS item(value)), '[]'::jsonb)),
      updated_at = now(), revision = inspection_properties.revision + 1`, [JSON.stringify(packed)]);
  return { rows: rows.length, properties: grouped.size, duplicates: rows.length - grouped.size };
}

export async function saveReview(db: Db, id: string, revision: number, review: InspectionReview): Promise<InspectionProperty | null> {
  const rows = await db.q<Row>(`WITH changed AS (
      UPDATE inspection_properties SET review = $3::jsonb, reviewed_at = now(), updated_at = now(), revision = revision + 1
      WHERE id = $1 AND revision = $2 RETURNING *
    ), audit AS (
      INSERT INTO inspection_review_events (property_id, review, revision)
      SELECT id, review, revision FROM changed
    ) SELECT id, data, review, revision, reviewed_at FROM changed`, [id, revision, JSON.stringify(review)]);
  return rows[0] ? record(rows[0]) : null;
}

export async function saveLocation(db: Db, id: string, revision: number, patch: Partial<PropertyInput>): Promise<InspectionProperty | null> {
  const rows = await db.q<Row>(`UPDATE inspection_properties SET data = data || $3::jsonb, updated_at = now(), revision = revision + 1
    WHERE id = $1 AND revision = $2 RETURNING id, data, review, revision, reviewed_at`, [id, revision, JSON.stringify(patch)]);
  return rows[0] ? record(rows[0]) : null;
}
