import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable().default(null);
const coordinate = (min: number, max: number) => z.number().finite().min(min).max(max).nullable().default(null);
export const propertyInput = z.object({
  address: text(250).min(3), city: text(100).min(2), batch: text(100).default("Imported list"),
  sourceIds: z.array(text(100)).max(100).default([]),
  lat: coordinate(38.7, 41.6), lng: coordinate(-75.7, -73.7),
  locationStatus: z.enum(["matched", "candidate", "unresolved"]).default("unresolved"),
  pin: nullableText(100), objectId: z.number().int().positive().nullable().default(null),
  county: nullableText(100), block: nullableText(50), lot: nullableText(50), qualifier: nullableText(50),
  tenureYears: z.number().finite().min(0).max(150).nullable().default(null),
  tenureConflict: z.boolean().default(false), mailDiff: z.boolean().nullable().default(null),
  outOfState: z.boolean().nullable().default(null), sheriffDate: nullableText(30),
  historicTaxAmount: z.number().finite().nonnegative().nullable().default(null),
  floodSfha: nullableText(100), propertyClass: nullableText(30), recordUrl: nullableText(2048),
  notes: text(4000).default(""),
}).refine((p) => (p.lat === null) === (p.lng === null), "Latitude and longitude must both be present or both be empty");
export type PropertyInput = z.infer<typeof propertyInput>;

const severity = z.number().int().min(0).max(3).nullable();
const reviewStatus = z.enum(["pending", "complete", "obscured", "unavailable"]);
export const reviewSchema = z.object({
  identityConfirmed: z.boolean(), streetStatus: reviewStatus, lotStatus: reviewStatus,
  imageryDate: text(30), evidenceSource: z.enum(["google", "field", "owner_photos", "licensed_imagery"]),
  evidenceReference: text(2000), reviewer: text(100).min(1),
  roof: severity, landscaping: severity, windows: severity, exterior: severity, vacancy: severity,
  recordsComplete: z.boolean(), foreclosure: z.union([z.literal(0), z.literal(20)]).nullable(),
  taxLien: z.union([z.literal(0), z.literal(10)]).nullable(),
  code: z.union([z.literal(0), z.literal(10)]).nullable(), recordsReference: text(2000),
  notes: text(4000), followUp: text(1000),
});
export type InspectionReview = z.infer<typeof reviewSchema>;
export type InspectionProperty = PropertyInput & { id: string; revision: number; review: InspectionReview | null; reviewedAt: string | null };
export const emptyReview = (): InspectionReview => ({
  identityConfirmed: false, streetStatus: "pending", lotStatus: "pending", imageryDate: "",
  evidenceSource: "google", evidenceReference: "", reviewer: "", roof: null, landscaping: null,
  windows: null, exterior: null, vacancy: null, recordsComplete: false, foreclosure: null,
  taxLien: null, code: null, recordsReference: "", notes: "", followUp: "",
});

export function addressKey(address: string, city: string): string {
  const suffix: Record<string, string> = { STREET: "ST", AVENUE: "AVE", ROAD: "RD", DRIVE: "DR", LANE: "LN", COURT: "CT", TERRACE: "TER", PLACE: "PL", BOULEVARD: "BLVD", PARKWAY: "PKWY", NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W" };
  const normalize = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, " ").split(/\s+/).filter(Boolean).map((w) => suffix[w] ?? w).join(" ");
  // Unit tokens are retained: different condo units must never be merged.
  return `${normalize(address)}|${normalize(city)}`;
}

export function prospectingScore(p: PropertyInput): number {
  const tenure = p.tenureConflict ? 0 : p.tenureYears === null ? 0 : p.tenureYears >= 10 ? 15 : p.tenureYears >= 5 ? 8 : 0;
  return tenure + (p.mailDiff === true ? 10 : 0) + (p.outOfState === true ? 5 : 0);
}

export function inspectionScore(p: PropertyInput, r: InspectionReview | null, googleScoringAllowed = false) {
  const values = r ? [r.roof, r.landscaping, r.windows, r.exterior, r.vacancy] : [];
  const physicalComplete = Boolean(r && r.identityConfirmed && r.streetStatus === "complete" && r.lotStatus === "complete" && r.imageryDate.trim() && r.evidenceReference.trim() && values.every((v) => v !== null) && (r.evidenceSource !== "google" || googleScoringAllowed));
  const physical = physicalComplete ? Math.round(values.reduce<number>((sum, v, i) => sum + v! * [15, 8, 12, 15, 10][i] / 3, 0) * 10) / 10 : null;
  const records = r && r.recordsComplete && r.recordsReference.trim() && [r.foreclosure, r.taxLien, r.code].every((v) => v !== null) ? r.foreclosure! + r.taxLien! + r.code! : null;
  const score = physical !== null && records !== null ? physical + records : null;
  const grade = score === null ? "U" : score >= 70 ? "A" : score >= 45 ? "B" : score >= 20 ? "C" : "D";
  const proxy = prospectingScore(p);
  return { physical, records, score, grade, proxy, priority: score === null ? null : Math.round((score * 0.7 + proxy) * 10) / 10 };
}

/** RFC 4180-style CSV reader: quoted commas/newlines, escaped quotes and BOM. */
export function parseCsv(input: string): Record<string, string>[] {
  const data = input.replace(/^\uFEFF/, "");
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c === '"') {
      if (quoted && data[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell.trim()) quoted = !quoted;
      else cell += c;
    } else if (!quoted && (c === "," || c === "\n" || c === "\r")) {
      row.push(cell); cell = "";
      if (c !== ",") { if (row.some((x) => x.trim())) rows.push(row); row = []; if (c === "\r" && data[i + 1] === "\n") i++; }
    } else cell += c;
  }
  if (quoted) throw new Error("Unclosed quoted field in CSV");
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  const headers = rows.shift()?.map((x) => x.trim()) ?? [];
  if (!headers.length || new Set(headers.map((h) => h.toLowerCase())).size !== headers.length) throw new Error("CSV needs unique column headers");
  if (rows.length > 10000) throw new Error("Import at most 10,000 rows at a time");
  return rows.map((values, i) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${i + 2} has ${values.length} fields; expected ${headers.length}`);
    return Object.fromEntries(headers.map((h, j) => [h.toLowerCase().replace(/[\s-]+/g, "_"), values[j].trim()]));
  });
}

export function csvProperty(row: Record<string, string>, batch: string): PropertyInput {
  const get = (...keys: string[]) => keys.map((k) => row[k]).find((x) => x !== undefined && x !== "") ?? "";
  const num = (...keys: string[]) => { const value = get(...keys); return value ? Number(value.replace(/[$,]/g, "")) : null; };
  const bool = (...keys: string[]) => { const v = get(...keys).toLowerCase(); return /^(yes|true|1)$/.test(v) ? true : /^(no|false|0)$/.test(v) ? false : null; };
  const lat = num("lat", "latitude", "latitude_—_centroid"); const lng = num("lng", "longitude", "longitude_—_centroid");
  return propertyInput.parse({
    address: get("original_address", "address", "property_address"), city: get("original_city", "city", "municipality"), batch,
    sourceIds: [get("lead_id", "id")].filter(Boolean), lat, lng,
    locationStatus: lat !== null && lng !== null ? (/^matched/i.test(get("parcel_match", "parcel_match_status")) ? "matched" : "candidate") : "unresolved",
    pin: get("parcel_pin", "pin") || null, objectId: num("object_id", "objectid"), county: get("county") || null,
    block: get("block") || null, lot: get("lot") || null, qualifier: get("qualifier") || null,
    tenureYears: num("years_since_tax_file_deed", "years_since_deed"), tenureConflict: Boolean(get("record_conflict")),
    mailDiff: bool("different_mailing_address", "mailing_differs"), outOfState: bool("out_of_state_mailing"),
    sheriffDate: get("sheriff_sale_date") || null, historicTaxAmount: num("historical_tax_sale_amount"),
    floodSfha: get("fema_sfha_centroid") || null, propertyClass: get("property_class") || null,
    recordUrl: get("parcel_source", "parcel_source_url") || null, notes: get("findings"),
  });
}

export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (typeof value !== "number" && /^[=+@\-\t\r\n]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}
