/**
 * npm run ghl:push -- ../data/processed/acq/waves/W01.jsonl [--dry-run] [--limit N] [--force]
 *
 * Pushes a wave (or a patch_*.jsonl) from scripts/10_acq_release.py into
 * GHL: contact + property records + association + one opportunity per
 * pipeline. Idempotent and crash-safe: GHL ids are saved after every owner
 * to data/processed/acq/ghl_ids.json, so a re-run resumes/updates in place.
 * Push the 25-record test batch first (--limit 25) and check it in the UI.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { Ghl } from "../src/lib/acq/ghl";
import { pushOwner, resolve, type IdMap, type WaveRecord } from "../src/lib/acq/sync";
import { loadEnv } from "./env";

loadEnv();
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const dry = args.includes("--dry-run");
const force = args.includes("--force");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
if (!file || !existsSync(file)) {
  console.error("usage: npm run ghl:push -- <wave.jsonl> [--dry-run] [--limit N]");
  process.exit(1);
}
const records: WaveRecord[] = readFileSync(file, "utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const idsPath = resolvePath(dirname(file), "..", "ghl_ids.json");
const logPath = file.replace(/\.jsonl$/, ".push.log.jsonl");
const ids: IdMap = existsSync(idsPath) ? JSON.parse(readFileSync(idsPath, "utf8")) : { owners: {}, properties: {} };

async function main() {
  const batch = records.slice(0, limit);
  const ops = batch.reduce<Record<string, number>>((a, r) => ((a[r.op] = (a[r.op] ?? 0) + 1), a), {});
  console.log(`${file}: ${batch.length} records ${JSON.stringify(ops)}`);
  const lanes = batch.reduce<Record<string, number>>((a, r) => ((a[r.contact.dial_lane] = (a[r.contact.dial_lane] ?? 0) + 1), a), {});
  console.log(`lanes ${JSON.stringify(lanes)}; already in ghl_ids.json: ${batch.filter((r) => ids.owners[r.owner_id]).length}`);
  if (dry) {
    console.log("\n(dry run) first record:\n" + JSON.stringify(batch[0], null, 2).slice(0, 2500));
    return;
  }
  const token = process.env.GHL_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error("Set GHL_TOKEN and GHL_LOCATION_ID (site/.env.local).");
  const ghl = new Ghl({ token, locationId });
  const r = await resolve(ghl, { fresh: true });
  const critical = r.missing.filter((m) => /pipeline|Dial Lane|Acq Owner ID|Residential Opportunity ID/.test(m));
  if (r.missing.length) console.log(`resolver: ${r.missing.length} unresolved (${r.missing.slice(0, 6).join("; ")})`);
  if (critical.length && !force) throw new Error(`critical schema pieces missing — run npm run ghl:provision first (${critical.join("; ")})`);
  if (!r.associationId) console.log("!! no contact<->property association yet: property records are created but not linked");

  const coldSmsDnd = process.env.GHL_COLD_SMS_DND !== "off";
  let ok = 0;
  let failed = 0;
  const t0 = Date.now();
  for (const [i, rec] of batch.entries()) {
    try {
      const res = await pushOwner(ghl, r, rec, ids, { coldSmsDnd });
      ok++;
      appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), owner_id: rec.owner_id, ok: true, ...res }) + "\n");
    } catch (e) {
      failed++;
      appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), owner_id: rec.owner_id, ok: false, error: String(e).slice(0, 500) }) + "\n");
      console.error(`  ${rec.owner_id}: ${String(e).slice(0, 200)}`);
      if (failed >= 5 && ok === 0) throw new Error("first 5 records all failed — stopping (see the .push.log.jsonl)");
    }
    writeFileSync(idsPath, JSON.stringify(ids));
    if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${batch.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
  console.log(`\ndone: ${ok} ok, ${failed} failed; ids -> ${idsPath}; log -> ${logPath}`);
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
