/**
 * npm run ghl:check — read-only smoke test of GHL_TOKEN / GHL_LOCATION_ID
 * (and WAVV_API_KEY if set). Run it first in a new session after adding the
 * keys. Changes nothing.
 */
import { Ghl, GhlError } from "../src/lib/acq/ghl";
import { PIPELINES, PROPERTY_OBJECT } from "../src/lib/acq/schema";
import { Wavv } from "../src/lib/acq/wavv";
import { loadEnv } from "./env";

loadEnv();

async function step(label: string, fn: () => Promise<string>): Promise<boolean> {
  try {
    console.log(`  ok    ${label}: ${await fn()}`);
    return true;
  } catch (e) {
    const why = e instanceof GhlError ? `HTTP ${e.status} ${e.body.slice(0, 160)}` : String(e).slice(0, 200);
    console.log(`  FAIL  ${label}: ${why}`);
    return false;
  }
}

async function main() {
  const token = process.env.GHL_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    console.log("GHL_TOKEN / GHL_LOCATION_ID not set — add them in the environment settings, then start a new session.");
    process.exit(1);
  }
  const ghl = new Ghl({ token, locationId });
  console.log(`GHL location ${locationId}`);
  await step("contact fields (token + scope)", async () => `${(await ghl.listFields("contact")).length} custom fields`);
  await step("opportunity fields", async () => `${(await ghl.listFields("opportunity")).length} custom fields`);
  await step("pipelines", async () => {
    const p = await ghl.listPipelines();
    const want = Object.values(PIPELINES).map((x) => x.name);
    return `${p.length} found; ours present: ${want.map((w) => `${w}=${p.some((x) => x.name === w) ? "yes" : "no"}`).join(", ")}`;
  });
  await step(`custom object ${PROPERTY_OBJECT.key}`, async () => {
    await ghl.getObject(PROPERTY_OBJECT.key);
    return "exists";
  });
  await step("users (needs users.readonly)", async () => {
    const u = await ghl.listUsers();
    return u.length
      ? "\n" + u.map((x) => `          ${x.id}  ${x.name ?? `${x.firstName ?? ""} ${x.lastName ?? ""}`.trim()}  ${x.email ?? ""}  ${x.roles?.role ?? ""}`).join("\n")
      : "none returned";
  });
  await step("workflows", async () => `${(await ghl.listWorkflows()).length} found`);
  if (process.env.WAVV_API_KEY) {
    const w = new Wavv(process.env.WAVV_API_KEY);
    await step("WAVV API key", async () => {
      const r = await w.listCalls({ direction: "outbound", limit: 1 });
      return `ok (${(r.data ?? r.calls ?? []).length} recent call returned)`;
    });
  } else {
    console.log("  skip  WAVV_API_KEY not set");
  }
  console.log("\nNext: npm run ghl:provision -- --dry-run");
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
