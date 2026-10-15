/**
 * npm run ghl:brief -- ../data/processed/acq/waves/W02.jsonl [more.jsonl ...] [--dry-run] [--refresh]
 *
 * Backfills the CALL BRIEF note (opener + property facts, no dollar figures)
 * on contacts already pushed. Skips contacts that already have one, so it is
 * safe to re-run. --refresh rewrites existing briefs after a script change.
 * New waves get the note from ghl:push automatically.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { Ghl } from "../src/lib/acq/ghl";
import { callBrief, ensureCallBrief, type IdMap, type WaveRecord } from "../src/lib/acq/sync";
import { loadEnv } from "./env";

loadEnv();
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const dry = args.includes("--dry-run");
const refresh = args.includes("--refresh");
if (!files.length || files.some((f) => !existsSync(f))) {
  console.error("usage: npm run ghl:brief -- <wave.jsonl> [...] [--dry-run]");
  process.exit(1);
}
const records: WaveRecord[] = files.flatMap((f) =>
  readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l) as WaveRecord),
).filter((r) => r.op === "upsert");
const ids: IdMap = JSON.parse(readFileSync(resolvePath(dirname(files[0]), "..", "ghl_ids.json"), "utf8"));

async function main() {
  console.log(`${records.length} owners in ${files.length} file(s)`);
  if (dry) {
    console.log("\n" + callBrief(records[0]));
    return;
  }
  const token = process.env.GHL_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token || !locationId) throw new Error("Set GHL_TOKEN and GHL_LOCATION_ID (site/.env.local).");
  const ghl = new Ghl({ token, locationId });
  let added = 0, updated = 0, had = 0, missing = 0, failed = 0;
  for (const [i, rec] of records.entries()) {
    const contactId = ids.owners[rec.owner_id]?.contactId;
    if (!contactId) { missing++; continue; }
    try {
      const res = await ensureCallBrief(ghl, contactId, rec, { refresh });
      if (res === "added") added++;
      else if (res === "updated") updated++;
      else had++;
    } catch (e) {
      failed++;
      console.log(`  ${rec.owner_id}: ${(e as Error).message}`);
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${records.length}`);
  }
  console.log(`done: ${added} added, ${updated} updated, ${had} unchanged, ${missing} not in ghl_ids.json, ${failed} failed`);
}
main().catch((e) => { console.error(e); process.exit(1); });
