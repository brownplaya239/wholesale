/**
 * Offline unit tests (no network, no database): npm run test:unit
 * Covers the spec's validation list at the logic level — property types,
 * sparse comps, duplicates, incomplete answers, provider outages.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { selectComps, valuate, stepsFor, type CompCandidate, type Subject } from "../src/lib/enrich/comps.ts";
import { computeWorksheet, defaultWorksheet } from "../src/lib/enrich/worksheet.ts";
import { buildInsights, assignWorkflow, firstTouch } from "../src/lib/enrich/insights.ts";
import { extractUnit } from "../src/lib/enrich/geocode.ts";
import { pickUnit, locationUnit, kindOf } from "../src/lib/enrich/parcel.ts";
import { parseSr1aLine, normalizeBlockLot, sr1aDate, nuLabel } from "../src/lib/sr1a.ts";
import { dedupeKey } from "../src/lib/leads/store.ts";
import { parseSource } from "../src/lib/leads/source.ts";
import { buildDossier } from "../src/lib/enrich/dossier.ts";

const NOW = new Date("2026-09-28T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const LAT = 40.0;
const LNG = -74.0;
const offset = (mi: number) => LAT + mi / 69; // ~1 mi of latitude = 1/69 degree

function subject(over: Partial<Subject> = {}): Subject {
  return { kind: "single_family", pin: "1300_1_1", muncode: "1300", block: "1", lot: "1", lat: LAT, lng: LNG, livingSpace: 1500, yearBuilt: 1970, acres: 0.25, dwellings: 1, ...over };
}
function cand(i: number, over: Partial<CompCandidate> = {}): CompCandidate {
  return { pin: `1300_9_${i}`, muncode: "1300", block: "9", lot: String(i), qual: "", saleDate: daysAgo(30 + i), price: 400_000 + i * 5_000, livingSpace: 1450 + i * 20, yearBuilt: 1968, location: `${i} MAIN ST`, municipality: "TEST TWP", lat: offset(0.2), lng: LNG, dwellings: 1, acres: 0.25, ...over };
}

test("single-family: nearby recent comps, per-sq-ft range, high confidence", () => {
  const r = selectComps(subject(), [1, 2, 3, 4, 5, 6].map((i) => cand(i)), NOW);
  assert.equal(r.comps.length, 6);
  assert.equal(r.windowDays, 180);
  assert.ok(r.valuation);
  assert.match(r.valuation!.method, /per sq ft/);
  assert.equal(r.valuation!.confidence, "high");
  assert.ok(r.valuation!.low <= r.valuation!.mid && r.valuation!.mid <= r.valuation!.high);
});

test("single-family excludes condos, multifamily, far-off sizes and the subject itself", () => {
  const pool = [
    cand(1),
    cand(2, { qual: "C0001" }),
    cand(3, { dwellings: 3 }),
    cand(4, { livingSpace: 4000 }),
    cand(5, { pin: "1300_1_1" }),
  ];
  const r = selectComps(subject(), pool, NOW);
  assert.deepEqual(r.comps.map((c) => c.pin), ["1300_9_1"]);
  assert.ok(r.note, "sparse result is flagged");
});

test("sparse coverage: lookback and radius expand only when needed", () => {
  const pool = [cand(1, { saleDate: daysAgo(500), lat: offset(2.5) }), cand(2, { saleDate: daysAgo(600), lat: offset(2.8) }), cand(3, { saleDate: daysAgo(400), lat: offset(2.2) })];
  const r = selectComps(subject(), pool, NOW);
  assert.equal(r.comps.length, 3);
  assert.equal(r.windowDays, 730);
  assert.ok(r.steps.length === stepsFor("single_family").length);
  assert.notEqual(r.valuation!.confidence, "high");
});

test("condo: same-building sales rank first", () => {
  const s = subject({ kind: "condo", pin: "1300_5_1_C0101", block: "5", lot: "1", livingSpace: 900 });
  const same = (i: number) => cand(i, { pin: `1300_5_1_C020${i}`, block: "5", lot: "1", qual: `C020${i}`, livingSpace: 880 + i * 10, lat: null, lng: null });
  const near = (i: number) => cand(i + 10, { qual: `C10${i}`, livingSpace: 900 });
  const r = selectComps(s, [near(1), near(2), same(1), same(2), same(3)], NOW);
  assert.ok(r.comps.slice(0, 3).every((c) => c.sameBuilding));
  assert.ok(r.valuation!.reasons.some((x) => /same-building/.test(x)));
});

test("multifamily: priced per unit from 2+ dwelling comps", () => {
  const s = subject({ kind: "multifamily", dwellings: 2, livingSpace: 2000 });
  const pool = [1, 2, 3, 4].map((i) => cand(i, { dwellings: 2, livingSpace: 1950, price: 600_000 + i * 10_000 })).concat([cand(9, { dwellings: 1 })]);
  const r = selectComps(s, pool, NOW);
  assert.ok(r.comps.every((c) => (c.dwellings ?? 0) >= 2));
  assert.match(r.valuation!.method, /per unit/);
});

test("vacant land: acreage-matched lots, lot prices (not per acre) for small parcels", () => {
  const s = subject({ kind: "land", livingSpace: null, yearBuilt: null, acres: 0.5 });
  const pool = [1, 2, 3].map((i) => cand(i, { livingSpace: null, acres: 0.45 + i * 0.02, price: 150_000 })).concat([cand(8, { acres: 5 })]);
  const r = selectComps(s, pool, NOW);
  assert.ok(r.comps.every((c) => (c.acres ?? 0) < 1.5));
  assert.match(r.valuation!.method, /similar acreage/);
  const big = valuate({ ...s, acres: 10 }, r.comps.map((c) => ({ ...c, pricePerAcre: 20_000 })), 180, 1);
  assert.match(big!.method, /per acre/);
});

test("no comps -> no invented valuation", () => {
  const r = selectComps(subject(), [], NOW);
  assert.equal(r.comps.length, 0);
  assert.equal(r.valuation, null);
});

test("worksheet math and editable assumptions", () => {
  const r = computeWorksheet({ asIsValue: 300_000, arv: 400_000, livingSpace: 1000, repairPerSqft: 40, repairFlat: 0, holdMonths: 6, monthlyTaxes: 500, monthlyInsurance: 100, monthlyUtilities: 200, purchaseClosingPct: 1.5, saleCommissionPct: 5, saleClosingPct: 1.5, targetProfitPct: 15, assignmentFee: 15_000, listCommissionPct: 5, listSellerClosingPct: 1.5, listCarryMonths: 3 });
  assert.equal(r.repairs, 40_000);
  assert.equal(r.carrying, 4_800);
  assert.equal(r.maxPurchase, 400_000 - 40_000 - 4_800 - 4_500 - 26_000 - 60_000);
  assert.equal(r.rule70, 240_000);
  assert.equal(r.wholesaleOffer, r.maxPurchase! - 15_000);
  assert.equal(r.listingNet, Math.round((300_000 * 0.935 - 800 * 3) / 100) * 100);
});

test("SR1A parsing: layout, block/lot normalization, dates, codes", () => {
  const line = "".padEnd(663, " ").split("");
  const put = (start: number, v: string) => v.split("").forEach((ch, i) => (line[start + i] = ch));
  put(0, "1325"); put(33, "U"); put(37, "000450000"); put(46, "000455000");
  put(297, "12 MAIN ST"); put(338, "260415"); put(344, "260501");
  put(350, "00029"); put(355, "02  "); put(359, "00010"); put(619, "C0012"); put(626, "2  "); put(652, "1962"); put(656, "0001480");
  const r = parseSr1aLine(line.join(""), NOW)!;
  assert.equal(r.pin, "1325_29.02_10_C0012");
  assert.equal(r.price, 455_000);
  assert.equal(r.deedDate, "2026-04-15");
  assert.equal(r.usable, true);
  assert.equal(r.livingSpace, 1480);
  assert.equal(normalizeBlockLot("00000", ""), "0");
  assert.equal(sr1aDate("990230", NOW), null);
  assert.equal(sr1aDate("950101", NOW), "1995-01-01");
  assert.equal(nuLabel("10"), "By guardian, trustee, executor or administrator (estate)");
  assert.equal(nuLabel(""), null);
});

test("condo unit parsing and matching (house number + unit)", () => {
  assert.deepEqual(extractUnit("4 Lake Ave Unit 7A, East Brunswick, NJ"), { base: "4 Lake Ave, East Brunswick, NJ", unit: "7A" });
  assert.deepEqual(extractUnit("1 Mechanic St #302, Absecon, NJ"), { base: "1 Mechanic St, Absecon, NJ", unit: "302" });
  assert.equal(extractUnit("12 Main St, Freehold, NJ").unit, null);
  assert.equal(locationUnit("4 LAKE AVE UNIT 07A"), "7A");
  const f = (pin: string, loc: string, q: string) => ({ attributes: { PAMS_PIN: pin, PROP_LOC: loc, PCLQCODE: q } });
  const units = [f("a", "3 LAKE AVE UNIT 7A", "C0312"), f("b", "4 LAKE AVE UNIT 7A", "C0412"), f("c", "4 LAKE AVE UNIT 6A", "C0410")];
  assert.equal(pickUnit(units, "7A", "4 Lake Ave").feature?.attributes.PAMS_PIN, "b");
  assert.equal(pickUnit(units, "7A", "").info.status, "unmatched");
  assert.equal(pickUnit(units, null, "4 Lake Ave").info.status, "needs_unit");
  assert.equal(pickUnit([f("x", "12 MAIN ST", "")], null).info.status, "not_applicable");
  assert.equal(kindOf("2", "C0001", 1), "condo");
  assert.equal(kindOf("2", "", 3), "multifamily");
  assert.equal(kindOf("1", "", null), "land");
});

test("duplicate detection key tolerates formatting differences", () => {
  assert.equal(dedupeKey("7276193299", "714 Dennisville Road, Cape May Court House, NJ"), dedupeKey("7276193299", "714  Dennisville Rd., Cape May CH"));
  assert.notEqual(dedupeKey("7276193299", "714 Dennisville Rd"), dedupeKey("7276193299", "716 Dennisville Rd"));
});

test("source attribution from the landing URL", () => {
  const s = parseSource("https://www.housesoldnj.com/?gad_source=5&gad_campaignid=24175684499&gclid=abc", "https://www.google.com/");
  assert.equal(s.channel, "google_ads");
  assert.equal(s.googleAds?.campaignId, "24175684499");
  assert.equal(parseSource("https://www.housesoldnj.com/about", null).channel, "direct");
});

test("incomplete optional answers are listed as missing, not guessed", () => {
  const ins = buildInsights(null, { name: "A B", timeline: null, priority: null, condition: null, occupancy: null, createdAt: NOW.toISOString() });
  assert.ok(ins.missing.includes("Timeline (seller didn't answer)"));
  const w = assignWorkflow(null, { name: "A B", timeline: "ASAP", priority: null, condition: null, occupancy: null, createdAt: NOW.toISOString() });
  assert.equal(w.track, "hot");
  assert.match(firstTouch(new Date("2026-09-28T06:30:00Z")), /outside 8 AM–9 PM/); // 2:30 AM ET
  assert.match(firstTouch(new Date("2026-09-28T16:00:00Z")), /within 5 minutes/); // noon ET
});

test("provider outage: every source fails -> dossier still builds, nothing invented", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError("network down"); }) as typeof fetch;
  try {
    const d = await buildDossier({ address: "12 Main St, Freehold, NJ 07728", unit: null, lead: { name: "A B", timeline: null, priority: null, condition: null, occupancy: null, createdAt: NOW.toISOString() } }, null);
    assert.equal(d.geocode.status, "error");
    assert.equal(d.parcel.data, null);
    assert.equal(d.comps.data, null);
    assert.equal(d.characteristics.yearBuilt.value, null);
    assert.ok(d.insights.risks.some((r) => /couldn't be matched/.test(r)));
    const ws = defaultWorksheet(d, null);
    assert.equal(ws.inputs.asIsValue, null, "no value is fabricated when sources fail");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("NJ geocoder down -> Census fallback is used and labeled", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("geo.nj.gov")) throw new TypeError("NJ service down");
    if (u.includes("geocoding.geo.census.gov")) {
      return new Response(JSON.stringify({ result: { addressMatches: [{ matchedAddress: "12 MAIN ST, FREEHOLD, NJ, 07728", coordinates: { x: -74.27, y: 40.26 } }] } }), { status: 200 });
    }
    throw new TypeError("blocked in test");
  }) as typeof fetch;
  try {
    const d = await buildDossier({ address: "12 Main St, Freehold, NJ 07728", unit: null, lead: { name: "A B", timeline: null, priority: null, condition: null, occupancy: null, createdAt: NOW.toISOString() } }, null);
    assert.equal(d.geocode.status, "ok");
    assert.equal(d.geocode.source?.id, "census_geocoder");
    assert.match(d.geocode.note ?? "", /Census fallback/);
    assert.equal(d.parcel.status, "error");
  } finally {
    globalThis.fetch = realFetch;
  }
});
