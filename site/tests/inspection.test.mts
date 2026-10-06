import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { addressKey, csvCell, csvProperty, emptyReview, inspectionScore, parseCsv, propertyInput } from "../src/lib/inspection/model.ts";
import { getDb, closeDb } from "../src/lib/db.ts";
import { getInspection, importInspection, listInspection } from "../src/lib/inspection/store.ts";
import { createSession } from "../src/lib/admin/auth.ts";
import { GET, POST } from "../src/app/api/admin/inspection/route.ts";
import { PATCH } from "../src/app/api/admin/inspection/[id]/route.ts";
import { GET as exportReviews } from "../src/app/api/admin/inspection/export/route.ts";

const property = (over = {}) => propertyInput.parse({ address: "12 Main Street", city: "Freehold", sourceIds: ["NJ-0001"], ...over });

test("CSV import handles quoted newlines, BOM, escaped quotes and ignores contacts", () => {
  const rows = parseCsv('\uFEFFAddress,City,First Name,Phone Number,findings\r\n"12 Main Street",Freehold,Private,5551234567,"roof note, then\nsecond line with ""quotes"""\r\n');
  const p = csvProperty(rows[0], "NJ Leads");
  assert.equal(p.notes, 'roof note, then\nsecond line with "quotes"');
  assert.equal(p.locationStatus, "unresolved");
  assert.equal((p as Record<string, unknown>).phone, undefined);
  assert.equal((p as Record<string, unknown>).name, undefined);
  assert.throws(() => parseCsv('Address,City\n"12 Main,Freehold'), /Unclosed/);
  assert.throws(() => parseCsv('Address,Address\na,b'), /unique/);
  assert.throws(() => parseCsv('Address,City\na,b,c'), /fields/);
});
test("matching preserves towns and condo units; unknown and candidate locations are explicit", () => {
  assert.equal(addressKey("12 Main Street", "Freehold"), addressKey("12 MAIN ST.", "Freehold"));
  assert.notEqual(addressKey("12 Main St #1", "Freehold"), addressKey("12 Main St #2", "Freehold"));
  assert.notEqual(addressKey("12 Main St", "Freehold"), addressKey("12 Main St", "Camden"));
  assert.equal(csvProperty({ address: "12 Main", city: "Freehold", lat: "40", lng: "-74" }, "test").locationStatus, "candidate");
  assert.throws(() => property({ lat: 40 }), /Latitude/);
  assert.throws(() => property({ lat: 0, lng: 0 }));
});
test("unknown is U; zero is D; all positive inputs give 100; current-record evidence required", () => {
  const p = property({ tenureYears: 11, mailDiff: true, outOfState: true });
  assert.equal(inspectionScore(p, null).grade, "U");
  const review = { ...emptyReview(), identityConfirmed: true, streetStatus: "complete" as const, lotStatus: "complete" as const, evidenceSource: "field" as const, imageryDate: "2026-10-06", evidenceReference: "Field visit 1", reviewer: "Tester", roof: 0, landscaping: 0, windows: 0, exterior: 0, vacancy: 0, recordsComplete: true, foreclosure: 0 as const, taxLien: 0 as const, code: 0 as const, recordsReference: "Current court and municipal searches" };
  assert.equal(inspectionScore(p, review).score, 0);
  assert.equal(inspectionScore(p, review).grade, "D");
  const high = { ...review, roof: 3, landscaping: 3, windows: 3, exterior: 3, vacancy: 3, foreclosure: 20 as const, taxLien: 10 as const, code: 10 as const };
  assert.deepEqual(inspectionScore(p, high), { physical: 60, records: 40, score: 100, grade: "A", proxy: 30, priority: 100 });
  assert.equal(inspectionScore(p, { ...high, roof: null }).score, null);
  assert.equal(inspectionScore(p, { ...high, recordsReference: "" }).score, null);
  assert.equal(inspectionScore(p, { ...high, imageryDate: "" }).score, null);
  assert.equal(inspectionScore(p, { ...high, evidenceSource: "google" }).score, null);
  assert.equal(inspectionScore(p, { ...high, evidenceSource: "google" }, true).score, 100);
  assert.equal(inspectionScore({ ...p, tenureConflict: true }, null).proxy, 15);
  assert.equal(csvCell('=HYPERLINK("malicious")'), '"\'=HYPERLINK(""malicious"")"');
  assert.equal(csvCell(-74.1), '"-74.1"', "numeric longitude remains usable in the export");
});

test("private import/review/export: atomic dedupe, no contacts, preserved reviews, revisions and auth", async () => {
  const previous = { db: process.env.DATABASE_URL, pg: process.env.POSTGRES_URL, dir: process.env.PGLITE_DIR, admin: process.env.ADMIN_PASSWORD, google: process.env.D4D_GOOGLE_DERIVED_CONTENT_ALLOWED };
  const dir = await mkdtemp(join(tmpdir(), "hsnj-inspection-"));
  delete process.env.DATABASE_URL; delete process.env.POSTGRES_URL;
  process.env.PGLITE_DIR = dir; process.env.ADMIN_PASSWORD = "local-inspection-test-only";
  delete process.env.D4D_GOOGLE_DERIVED_CONTENT_ALLOWED;
  try {
    const db = (await getDb())!; assert.ok(db);
    const token = (await createSession())!;
    const request = (path: string, method = "GET", body?: unknown, origin = "http://localhost:8765") => new NextRequest(`http://localhost:8765${path}`, { method, headers: { cookie: `hsnj_admin=${token}`, origin, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    assert.equal((await GET(new NextRequest("http://localhost:8765/api/admin/inspection"))).status, 401);
    assert.equal((await POST(request("/api/admin/inspection", "POST", { rows: [property()] }, "https://attacker.example"))).status, 403);
    assert.equal((await POST(request("/api/admin/inspection", "POST", { rows: [{ address: "a", city: "b" }] }))).status, 400);
    const result = await POST(request("/api/admin/inspection", "POST", { rows: [property(), { ...property({ address: "12 MAIN ST", sourceIds: ["NJ-0002"] }), phone: "PRIVATE_PHONE", name: "PRIVATE_NAME" }, property({ address: "12 Main St #2" })] }));
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).imported, { rows: 3, properties: 2, duplicates: 1 });
    let rows = await listInspection(db); assert.equal(rows.length, 2);
    const main = rows.find((r) => r.sourceIds.includes("NJ-0002"))!;
    assert.equal(main.sourceIds.length, 2);
    assert.ok(!JSON.stringify(rows).includes("PRIVATE_"));
    const context = { params: Promise.resolve({ id: main.id }) };
    const review = { ...emptyReview(), reviewer: "Tester", notes: "Awaiting inspection" };
    assert.equal((await PATCH(request(`/api/admin/inspection/${main.id}`, "PATCH", { revision: main.revision, review: { ...review, roof: 3 } }), context)).status, 400, "Google-derived scores require allowed use");
    const saved = await PATCH(request(`/api/admin/inspection/${main.id}`, "PATCH", { revision: main.revision, review }), context);
    assert.equal(saved.status, 200);
    assert.equal((await PATCH(request(`/api/admin/inspection/${main.id}`, "PATCH", { revision: main.revision, review }), context)).status, 409);
    await importInspection(db, [property({ sourceIds: ["NJ-0003"], notes: "New snapshot" })]);
    const refreshed = (await getInspection(db, main.id))!;
    assert.equal(refreshed.review?.notes, "Awaiting inspection");
    assert.deepEqual([...refreshed.sourceIds].sort(), ["NJ-0001", "NJ-0002", "NJ-0003"]);
    assert.equal((await db.q("SELECT * FROM inspection_review_events")).length, 1);
    const exported = await exportReviews(request("/api/admin/inspection/export"));
    assert.equal(exported.status, 200);
    const csv = parseCsv(await exported.text());
    assert.equal(csv.filter((r) => r.inspection_id === main.id).length, 3, "one exported row per source ID");
    assert.equal(csv[0].distress_score_100, ""); assert.equal(csv[0].distress_grade, "U");
    const raw = property({ address: "14 Main St", sourceIds: [] });
    await importInspection(db, [raw]); await importInspection(db, [raw]);
    assert.deepEqual((await listInspection(db)).find((p) => p.address === "14 Main St")!.sourceIds, [], "raw CSV reimports preserve an empty source-ID array");
    await importInspection(db, [property({ address: "16 Main St", lat: 40, lng: -74, locationStatus: "matched", pin: "TEST_PIN", objectId: 123, block: "1", lot: "2", tenureYears: 12, tenureConflict: true })]);
    await importInspection(db, [property({ address: "16 Main St", lat: 40.1, lng: -74.1, locationStatus: "candidate" })]);
    const located = (await listInspection(db)).find((p) => p.address === "16 Main St")!;
    assert.equal(located.locationStatus, "matched"); assert.equal(located.lat, 40);
    assert.equal(located.pin, "TEST_PIN"); assert.equal(located.block, "1");
    assert.equal(located.tenureYears, 12); assert.equal(located.tenureConflict, true);
  } finally {
    await closeDb(); await rm(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries({ DATABASE_URL: previous.db, POSTGRES_URL: previous.pg, PGLITE_DIR: previous.dir, ADMIN_PASSWORD: previous.admin, D4D_GOOGLE_DERIVED_CONTENT_ALLOWED: previous.google })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
