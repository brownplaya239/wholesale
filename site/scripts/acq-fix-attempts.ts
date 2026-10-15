/**
 * npm run acq:fix-attempts -- [--since 2026-10-15] [--dry-run]
 *
 * One-off repair for days dialed before the one-attempt-per-day rule: rebuilds
 * each pushed contact's "Call Attempts" from WAVV's call history as the number
 * of distinct ET days it was dialed (caller-skipped "Agent Canceled" and
 * aborted 0 s dials don't count), and re-derives "Next Call Due" from the
 * cadence. Only touches contacts still in the no-answer cadence (power/manual
 * lane, last disposition No Answer / Voicemail) whose count is too high.
 * Run AFTER the day's dialing ends — a live disposition would overwrite it.
 */
import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { Ghl } from "../src/lib/acq/ghl";
import { nextCallDue, ymd } from "../src/lib/acq/dispositions";
import { cf, readFields, resolve, type IdMap } from "../src/lib/acq/sync";
import { wavvFromEnv, type WavvCall } from "../src/lib/acq/wavv";
import { loadEnv } from "./env";

loadEnv();
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : "2026-10-14";
const etDay = (d: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(d));
const counts = (c: WavvCall) => {
  const disp = String(c.disposition ?? "");
  if (/^agent\s*cancel/i.test(disp)) return false;
  return Boolean(disp) || (c.seconds ?? 0) > 0;
};

async function main() {
  const wavv = wavvFromEnv();
  const token = process.env.GHL_TOKEN;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!wavv || !token || !locationId) throw new Error("Set WAVV_API_KEY, GHL_TOKEN, GHL_LOCATION_ID.");
  const ghl = new Ghl({ token, locationId });
  const r = await resolve(ghl, { fresh: true });

  const calls: WavvCall[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const res = await wavv.listCalls({ direction: "outbound", startedAfter: `${since}T04:00:00Z`, cursor, limit: 100 });
    const batch = res.data ?? res.calls ?? [];
    calls.push(...batch);
    cursor = res.nextCursor ?? undefined;
    if (!cursor || !batch.length) break;
  }
  const byContact = new Map<string, WavvCall[]>();
  for (const c of calls) if (c.contactId && counts(c)) byContact.set(c.contactId, [...(byContact.get(c.contactId) ?? []), c]);
  console.log(`${calls.length} outbound calls since ${since}; ${byContact.size} contacts dialed`);

  const ids: IdMap = JSON.parse(readFileSync(resolvePath(process.cwd(), "../data/processed/acq/ghl_ids.json"), "utf8"));
  const known = new Set(Object.values(ids.owners).map((o) => o.contactId));
  let fixed = 0;
  let ok = 0;
  let skipped = 0;
  for (const [contactId, list] of byContact) {
    if (!known.has(contactId)) continue;
    const days = [...new Set(list.map((c) => etDay(c.startedAt!)))].sort();
    const { contact } = await ghl.getContact(contactId);
    const f = readFields(r, contact.customFields as Record<string, unknown>[]);
    const current = Number(f["Call Attempts"] ?? 0);
    const lane = String(f["Dial Lane"] ?? "");
    const last = String(f["Last Disposition"] ?? "");
    if (current <= days.length) {
      ok++;
      continue;
    }
    if (!["power", "manual"].includes(lane) || !/no answer|voicemail/i.test(last)) {
      skipped++;
      console.log(`  skip ${contactId}: ${current} attempts vs ${days.length} days, lane ${lane}, last "${last}" (left as is)`);
      continue;
    }
    const lastDay = new Date(`${days.at(-1)}T16:00:00Z`);
    const due = nextCallDue(days.length, lastDay);
    console.log(`  ${contactId}: attempts ${current} -> ${days.length}, next due ${due ? ymd(due) : "—"}`);
    if (!dry) {
      await ghl.updateContact(contactId, { customFields: cf(r.contact, { "Call Attempts": days.length, "Next Call Due": due ? ymd(due) : null }) });
    }
    fixed++;
  }
  console.log(`${dry ? "(dry run) would fix" : "fixed"} ${fixed}; already correct ${ok}; left alone ${skipped}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
