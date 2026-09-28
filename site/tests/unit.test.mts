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
import { buildDossier, withSellerFacts } from "../src/lib/enrich/dossier.ts";
import { mlsNearby, mlsSubject, streetKey, testFeeds } from "../src/lib/enrich/mls.ts";

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

// --- MLS (RESO Web API) -----------------------------------------------------

const FACTS = { name: "Pat Seller", timeline: null, priority: null, condition: null, occupancy: null, createdAt: NOW.toISOString() };
const MLS_ENV = ["MLS_MOMLS_URL", "MLS_MOMLS_TOKEN", "MLS_CJMLS_URL", "MLS_CJMLS_TOKEN", "MLS_CJMLS_CLIENT_ID", "MLS_CJMLS_CLIENT_SECRET", "MLS_CJMLS_TOKEN_URL"];

async function withMls(env: Record<string, string>, handler: (url: URL, init?: RequestInit) => Response | Promise<Response>, fn: () => Promise<void>) {
  const realFetch = globalThis.fetch;
  for (const k of MLS_ENV) delete process.env[k];
  Object.assign(process.env, env);
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => handler(new URL(String(url)), init)) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = realFetch;
    for (const k of MLS_ENV) delete process.env[k];
  }
}
const reso = (value: object[]) => new Response(JSON.stringify({ value }), { status: 200 });
const row = (over: Record<string, unknown>) => ({
  ListingKey: "k", ListingId: "22012345", StandardStatus: "Closed", StreetNumber: "12", StreetName: "Main Street",
  City: "Freehold", PostalCode: "07728", PropertyType: "Residential", BedroomsTotal: 3, BathroomsFull: 2, BathroomsHalf: 1,
  LivingArea: 1650, YearBuilt: 1962, ListPrice: 499000, ListOfficeName: "Other Realty", ModificationTimestamp: "2026-05-01T00:00:00Z",
  Latitude: LAT, Longitude: LNG, ...over,
});

test("MLS not connected: sections say so, beds/baths listed as missing", async () => {
  await withMls({}, () => { throw new TypeError("no network in test"); }, async () => {
    const s = await mlsSubject("12 Main St, Freehold, NJ, 07728", "07728", null);
    assert.equal(s.status, "not_configured");
    assert.match(s.note ?? "", /MOMLS\/CJMLS/);
    assert.equal((await mlsNearby("07728", LAT, LNG, "12 Main St")).status, "not_configured");
    assert.deepEqual(await testFeeds(), []);
  });
});

test("MLS subject: bearer token, street/unit matching, beds/baths, active listing", async () => {
  const seen: string[] = [];
  await withMls(
    { MLS_MOMLS_URL: "https://mls.test/Reso/OData/", MLS_MOMLS_TOKEN: "tok123" },
    (url, init) => {
      seen.push((init?.headers as Record<string, string>).Authorization);
      assert.match(url.searchParams.get("$filter") ?? "", /StreetNumber eq '12'/);
      return reso([
        row({ StandardStatus: "Active", ListingId: "A1", ListPrice: 525000, OnMarketDate: "2026-08-01", ModificationTimestamp: "2026-09-01T00:00:00Z" }),
        row({ StandardStatus: "Expired", ListingId: "E1", BedroomsTotal: null, ModificationTimestamp: "2025-12-01T00:00:00Z" }),
        row({ StreetName: "Maple Ave", ListingId: "X1" }), // same number, different street
        row({ StreetName: "Main", StreetSuffix: "St", UnitNumber: "4", ListingId: "U4" }), // a unit, subject has none -> still same street
      ]);
    },
    async () => {
      const s = await mlsSubject("12 Main St, Freehold, New Jersey, 07728", "07728", null);
      assert.equal(s.status, "ok");
      assert.ok(seen.every((a) => a === "Bearer tok123"));
      const ids = s.data!.records.map((r) => r.listingId);
      assert.ok(!ids.includes("X1"), "different street excluded");
      assert.equal(ids[0], "A1", "newest first");
      assert.equal(s.data!.beds, 3);
      assert.equal(s.data!.baths, 2.5, "full + half baths");
      assert.equal(s.data!.activeListing?.listingId, "A1");
      const unit = await mlsSubject("12 Main St, Freehold, New Jersey, 07728", "07728", "4");
      assert.deepEqual(unit.data!.records.map((r) => r.listingId), ["U4"], "unit must match when given");
    }
  );
});

test("MLS: server rejects $select -> retried without it; 401 stops immediately", async () => {
  let calls = 0;
  await withMls(
    { MLS_MOMLS_URL: "https://mls.test/odata", MLS_MOMLS_TOKEN: "t" },
    (url) => {
      calls++;
      return url.searchParams.has("$select") ? new Response("bad select", { status: 400 }) : reso([row({})]);
    },
    async () => {
      const s = await mlsSubject("12 Main St, Freehold, NJ, 07728", "07728", null);
      assert.equal(s.status, "ok");
      assert.equal(calls, 2);
    }
  );
  calls = 0;
  await withMls(
    { MLS_MOMLS_URL: "https://mls.test/odata", MLS_MOMLS_TOKEN: "bad" },
    () => {
      calls++;
      return new Response("unauthorized", { status: 401 });
    },
    async () => {
      const s = await mlsSubject("12 Main St, Freehold, NJ, 07728", "07728", null);
      assert.equal(s.status, "error");
      assert.equal(calls, 1, "bad credentials aren't retried with other query variants");
    }
  );
});

test("MOMLS with only a token: Spark endpoints probed, first that accepts it is used", async () => {
  const hosts: string[] = [];
  await withMls(
    { MLS_MOMLS_TOKEN: "idx-token" },
    (url) => {
      hosts.push(url.origin + url.pathname);
      if (url.hostname === "replication.sparkapi.com") return new Response("forbidden", { status: 403 });
      if (url.pathname === "/Reso/OData/Property") return reso([row({ StandardStatus: url.searchParams.get("$filter")?.includes("Expired") ? undefined : "Active" })].filter((r) => r.StandardStatus));
      return new Response("not found", { status: 404 });
    },
    async () => {
      const [t] = await testFeeds();
      assert.equal(t.ok, true, t.detail);
      assert.equal(t.endpoint, "https://sparkapi.com/Reso/OData");
      assert.equal(t.statuses!.Active, true);
      assert.equal(t.statuses!.Expired, false);
      assert.match(t.detail, /not in this feed: Expired/);
      const s = await mlsSubject("12 Main St, Freehold, NJ, 07728", "07728", null);
      assert.equal(s.status, "ok");
      assert.ok(hosts.filter((h) => h.startsWith("https://replication")).length <= 2, "working endpoint is remembered");
    }
  );
});

test("MLS OAuth2 client credentials: token fetched once and reused", async () => {
  let tokenCalls = 0;
  await withMls(
    { MLS_CJMLS_URL: "https://cj.test/odata", MLS_CJMLS_CLIENT_ID: "id", MLS_CJMLS_CLIENT_SECRET: "secret", MLS_CJMLS_TOKEN_URL: "https://cj.test/token" },
    async (url, init) => {
      if (url.pathname === "/token") {
        tokenCalls++;
        assert.match(String(init?.body), /grant_type=client_credentials/);
        return new Response(JSON.stringify({ access_token: "oauth-abc", expires_in: 3600 }), { status: 200 });
      }
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer oauth-abc");
      return reso([row({ StandardStatus: "Closed", ClosePrice: 480000, CloseDate: "2024-03-01" })]);
    },
    async () => {
      const s = await mlsSubject("12 Main St, Freehold, NJ, 07728", "07728", null);
      await mlsSubject("12 Main St, Freehold, NJ, 07728", "07728", null);
      assert.equal(s.data!.records[0].feed, "Central Jersey MLS (CJMLS)");
      assert.equal(s.data!.records[0].closePrice, 480000);
      assert.equal(tokenCalls, 1);
    }
  );
});

test("MLS nearby: current listings only, subject/leases/far-off excluded, nearest first", async () => {
  await withMls(
    { MLS_MOMLS_URL: "https://mls.test/odata", MLS_MOMLS_TOKEN: "t" },
    () =>
      reso([
        row({ StreetNumber: "40", StreetName: "Oak Rd", UnparsedAddress: "40 Oak Rd, Freehold, NJ 07728", StandardStatus: "Active", Latitude: offset(0.8) }),
        row({ StreetNumber: "9", StreetName: "Elm St", UnparsedAddress: "9 Elm St, Freehold, NJ 07728", StandardStatus: "Pending", Latitude: offset(0.3) }),
        row({ UnparsedAddress: "12 Main St, Freehold, NJ 07728", StandardStatus: "Active" }), // the subject itself
        row({ UnparsedAddress: "5 Far Ln, Freehold, NJ 07728", StandardStatus: "Active", Latitude: offset(3) }),
        row({ UnparsedAddress: "7 Lease Ct, Freehold, NJ 07728", StandardStatus: "Active", PropertyType: "Residential Lease" }),
        row({ UnparsedAddress: "8 Sold Ct, Freehold, NJ 07728", StandardStatus: "Closed" }),
        row({ UnparsedAddress: "3 Hold Ct, Freehold, NJ 07728", StandardStatus: "Hold" }),
      ]),
    async () => {
      const n = await mlsNearby("07728", LAT, LNG, "12 Main St, Freehold, New Jersey, 07728");
      assert.equal(n.status, "ok");
      assert.deepEqual(n.data!.map((l) => l.address.split(",")[0]), ["9 Elm St", "40 Oak Rd"]);
      assert.ok(n.data![0].distanceMi! < n.data![1].distanceMi!);
    }
  );
  assert.equal(streetKey("Dennisville Road"), streetKey("DENNISVILLE RD"));
});

test("listed with another broker -> LISTED-ELSEWHERE, verify track; seller beds/baths fill gaps or conflict", async () => {
  await withMls(
    { MLS_MOMLS_URL: "https://mls.test/odata", MLS_MOMLS_TOKEN: "t" },
    (url) => {
      if (url.hostname === "mls.test") return reso([row({ StandardStatus: "Active", OnMarketDate: "2026-09-01" })]);
      throw new TypeError("public sources blocked in test");
    },
    async () => {
      const d = await buildDossier({ address: "12 Main St, Freehold, NJ 07728", unit: null, lead: FACTS }, null);
      // Geocoding is blocked here, so the MLS lookup never ran; exercise insights directly.
      assert.equal(d.mls?.subject.status, "missing");
      const s = await mlsSubject("12 Main St, Freehold, NJ, 07728", "07728", null);
      const geocode = { ...d.geocode, status: "ok" as const, data: { standardized: "12 Main St, Freehold, NJ, 07728", lat: LAT, lng: LNG, score: 100, matchType: "PointAddress", match: "exact" as const, county: "Monmouth", city: "Freehold", postal: "07728", unit: null } };
      const listed = { ...d, geocode, mls: { subject: s, nearby: d.mls!.nearby } };
      const ins = buildInsights(listed, FACTS);
      assert.ok(ins.tags.includes("LISTED-ELSEWHERE"));
      assert.ok(ins.risks.some((r) => /Other Realty/.test(r) && /don't interfere/.test(r)));
      const wf = assignWorkflow(listed, { ...FACTS, timeline: "ASAP" });
      assert.equal(wf.track, "verify", "listing check beats HOT");
      assert.match(wf.steps[0], /listing agreement's status and expiration/);
      assert.ok(!wf.steps.some((s) => /exact address/.test(s)), "address is fine — no address step");

      // No MLS beds/baths: seller's answers fill in, labeled as seller-reported.
      const filled = withSellerFacts(d, { beds: "4", baths: "2.5" });
      assert.equal(filled.characteristics.bedrooms.value, 4);
      assert.equal(filled.characteristics.bathrooms.source?.id, "seller");
      // MLS says 3 bd; seller says 4 -> surfaced as a conflict, MLS value kept.
      const withMlsBeds = { ...d, characteristics: { ...d.characteristics, bedrooms: { value: 3, status: "ok" as const, source: { id: "mls", name: "MLS", retrievedAt: "" } } } };
      const clash = withSellerFacts(withMlsBeds, { beds: "4", baths: null });
      assert.equal(clash.characteristics.bedrooms.value, 3);
      assert.deepEqual(clash.conflicts.find((c) => c.field === "bedrooms")?.values.map((v) => v.source), ["MLS", "seller"]);
      assert.equal(withSellerFacts(withMlsBeds, { beds: "3", baths: null }).conflicts.length, d.conflicts.length, "agreement adds no conflict");
      assert.equal(withSellerFacts(withMlsBeds, { beds: "5+", baths: null }).conflicts.length, d.conflicts.length + 1);
    }
  );
});
