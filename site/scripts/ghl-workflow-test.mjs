#!/usr/bin/env node
/**
 * No-phone API test of the two ACQ workflows (docs/GO_LIVE_CHECKLIST.md 1.3).
 *
 *   node site/scripts/ghl-workflow-test.mjs [--wait 90] [--keep] [--cleanup] [--no-reentry]
 *
 * Needs GHL_TOKEN + GHL_LOCATION_ID (env or site/.env.local); GHL_OWNER_USER_ID
 * is optional (defaults to the user named Sumeet in the sub-account).
 *
 * Creates throw-away contacts with NO phone number (so no SMS can ever leave),
 * tagged `acq:test`, adds the trigger tags over the API and reads back what the
 * workflows did. Push notifications are not visible over the API; the
 * observable effects are the contact assignment (Hot/Booked) and the task
 * (Inbound). The checks:
 *
 *   1. guard     `acq:inbound` on contacts carrying `no-sms` / `dnc` / DND must
 *                create NO task (If/Else OR-guard). A 4th, SMS-channel-only DND
 *                variant is reported for information.
 *   2. inbound   `acq:inbound` on a consented contact creates the "Call within
 *                5 min" task, assigned to Sumeet, due today.
 *   3. hot       tag `hot`    -> contact assigned to Sumeet.
 *   4. booked    tag `booked` -> contact assigned to Sumeet.
 *   + reentry    (extra) unassign + re-add `hot` -> assigned again (Allow re-entry).
 *
 * Test contacts are deleted at the end unless --keep. --cleanup deletes every
 * contact tagged `acq:test` (leftovers from a --keep or a crashed run) and exits.
 * While both workflows are still in Draft every check reports "nothing fired":
 * that is the expected baseline, not a failure of the script.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ----------------------------------------------------------------- env ----
const here = dirname(fileURLToPath(import.meta.url));
for (const dir of [process.cwd(), resolve(here, "..")]) {
  for (const name of [".env.local", ".env"]) {
    const p = resolve(dir, name);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]] !== undefined) continue;
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const WAIT_S = Number(opt("--wait", 90));
const KEEP = flag("--keep");
const CLEANUP = flag("--cleanup");
const REENTRY = !flag("--no-reentry");
const TEST_TAG = "acq:test";
const TASK_TITLE_RE = /call/i; // checklist: "Call within 5 min"

const token = process.env.GHL_TOKEN;
const locationId = process.env.GHL_LOCATION_ID;
if (!token || !locationId) {
  console.error("GHL_TOKEN / GHL_LOCATION_ID not set (env or site/.env.local).");
  process.exit(2);
}

// ----------------------------------------------------------------- api ----
const BASE = "https://services.leadconnectorhq.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function api(method, path, { query, body } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const wait = last + 120 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (res.ok) return text ? JSON.parse(text) : {};
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const err = new Error(`GHL ${res.status} ${method} ${path}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
}
const getContact = async (id) => (await api("GET", `/contacts/${id}`)).contact ?? {};
const getTasks = async (id) => (await api("GET", `/contacts/${id}/tasks`)).tasks ?? [];
const addTags = (id, tags) => api("POST", `/contacts/${id}/tags`, { body: { tags } });
const removeTags = (id, tags) => api("DELETE", `/contacts/${id}/tags`, { body: { tags } });
const deleteContact = (id) => api("DELETE", `/contacts/${id}`);

let seq = 0;
async function createContact(label, extra = {}) {
  const base = {
    locationId,
    firstName: "ZZ Test",
    lastName: label,
    source: "acq-workflow-test",
    tags: [TEST_TAG, ...(extra.tags ?? [])],
  };
  const body = { ...base, ...extra, tags: base.tags };
  try {
    return (await api("POST", "/contacts/", { body })).contact;
  } catch (e) {
    // Some builds insist on an email or phone. A fake email keeps it no-phone.
    if (e.status === 400 || e.status === 422) {
      const email = `acq-test-${Date.now()}-${seq++}@example.invalid`;
      return (await api("POST", "/contacts/", { body: { ...body, email } })).contact;
    }
    throw e;
  }
}

async function findTestContacts() {
  try {
    const r = await api("POST", "/contacts/search", {
      body: { locationId, page: 1, pageLimit: 100, filters: [{ field: "tags", operator: "eq", value: TEST_TAG }] },
    });
    return (r.contacts ?? []).filter((c) => (c.tags ?? []).includes(TEST_TAG));
  } catch {
    const r = await api("GET", "/contacts/", { query: { locationId, query: "ZZ Test", limit: 100 } });
    return (r.contacts ?? []).filter((c) => (c.tags ?? []).includes(TEST_TAG));
  }
}

// ------------------------------------------------------------- helpers ----
function etNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const h = Number(get("hour")) % 24;
  const wd = get("weekday");
  const inWindow = wd !== "Sun" && h >= 9 && h < 20;
  return { label: `${wd} ${get("hour")}:${get("minute")} ET`, inWindow };
}
function sameEtDay(iso) {
  if (!iso) return false;
  const f = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);
  return f(new Date(iso)) === f(new Date());
}
const pad = (s, n) => String(s).padEnd(n);

// ---------------------------------------------------------------- main ----
async function main() {
  if (CLEANUP) {
    // The search index lags deletes by minutes, so already-gone ids are normal.
    const found = await findTestContacts();
    let deleted = 0;
    let stale = 0;
    for (const c of found) {
      try {
        await deleteContact(c.id);
        deleted++;
        console.log(`deleted ${c.id} ${c.firstName ?? ""} ${c.lastName ?? ""}`);
      } catch (e) {
        if ((e.status === 400 || e.status === 404) && /not found/i.test(e.body ?? "")) stale++;
        else throw e;
      }
    }
    console.log(`cleanup: ${deleted} contact(s) tagged ${TEST_TAG} deleted, ${stale} already gone (stale search index)`);
    return;
  }

  // Who is Sumeet
  const users = (await api("GET", "/users/", { query: { locationId } })).users ?? [];
  const byName = users.find((u) => /sumeet/i.test(u.name ?? `${u.firstName ?? ""} ${u.lastName ?? ""}`));
  const sumeetId = process.env.GHL_OWNER_USER_ID || byName?.id;
  if (!sumeetId) throw new Error("No GHL_OWNER_USER_ID and no user named Sumeet in /users/");
  const sumeetName = users.find((u) => u.id === sumeetId)?.name ?? "(not in /users/)";
  console.log(`location ${locationId}; ${users.length} user(s); Sumeet = ${sumeetId} ${sumeetName}`);
  if (users.length === 1) {
    console.log("note: only one user exists, so 'Sumeet' and 'Account Owner' resolve to the same id over the API;");
    console.log("      the 'named specifically' part of 1.3 is only verifiable in the workflow editor.");
  }

  // Workflow status
  const wfs = (await api("GET", "/workflows/", { query: { locationId } })).workflows ?? [];
  const wfInbound = wfs.find((w) => /inbound/i.test(w.name));
  const wfHot = wfs.find((w) => /hot/i.test(w.name) && /book/i.test(w.name));
  for (const [k, w] of [["inbound", wfInbound], ["hot/booked", wfHot]]) {
    console.log(`workflow ${pad(k, 11)} ${w ? `${w.status}  ${w.name}` : "NOT FOUND"}`);
  }
  const anyPublished = [wfInbound, wfHot].some((w) => w && w.status === "published");
  if (!anyPublished) console.log("both workflows are in draft: expect 'nothing fired' on every check (baseline run).");
  const et = etNow();
  console.log(`now ${et.label}; 9a-8p Mon-Sat window: ${et.inWindow ? "OPEN" : "CLOSED (an inbound task may be held by a wait step)"}`);

  // Create test contacts
  console.log(`\ncreating test contacts (no phone, tag ${TEST_TAG}) ...`);
  const C = {};
  const mk = async (key, label, extra) => {
    C[key] = await createContact(label, extra);
    console.log(`  ${pad(key, 9)} ${C[key].id}`);
  };
  await mk("g_nosms", "Guard no-sms", { tags: ["no-sms"] });
  await mk("g_dnc", "Guard dnc", { tags: ["dnc"] });
  await mk("g_dnd", "Guard DND", { dnd: true });
  let smsDndOk = true;
  try {
    await mk("g_smsdnd", "Guard SMS-DND", { dndSettings: { SMS: { status: "inactive", message: "acq test" } } });
    const back = await getContact(C.g_smsdnd.id);
    smsDndOk = back.dndSettings?.SMS?.status === "inactive";
    if (!smsDndOk) console.log("  (dndSettings not stored on create — SMS-DND variant is informational only)");
  } catch (e) {
    smsDndOk = false;
    console.log(`  (dndSettings rejected: ${String(e.message).slice(0, 120)} — SMS-DND variant skipped)`);
  }
  await mk("inbound", "Inbound consented", {});
  await mk("hot", "Hot", {});
  await mk("booked", "Booked", {});

  // Fire the triggers
  console.log("adding trigger tags ...");
  for (const k of ["g_nosms", "g_dnc", "g_dnd", ...(C.g_smsdnd ? ["g_smsdnd"] : []), "inbound"]) await addTags(C[k].id, ["acq:inbound"]);
  await addTags(C.hot.id, ["hot"]);
  await addTags(C.booked.id, ["booked"]);
  const t0 = Date.now();

  // Poll
  const state = {};
  const guardKeys = ["g_nosms", "g_dnc", "g_dnd", ...(C.g_smsdnd ? ["g_smsdnd"] : [])];
  const pending = new Set(["inbound", "hot", "booked", ...guardKeys]);
  console.log(`polling up to ${WAIT_S}s ...`);
  while (pending.size && Date.now() - t0 < WAIT_S * 1000) {
    await sleep(5000);
    for (const k of [...pending]) {
      if (k === "hot" || k === "booked") {
        const c = await getContact(C[k].id);
        if (c.assignedTo) { state[k] = { assignedTo: c.assignedTo, at: Date.now() - t0 }; pending.delete(k); }
      } else {
        const tasks = await getTasks(C[k].id);
        if (tasks.length) { state[k] = { tasks, at: Date.now() - t0 }; pending.delete(k); }
      }
    }
  }
  // Final read for anything that never fired
  for (const k of pending) {
    state[k] = k === "hot" || k === "booked"
      ? { assignedTo: (await getContact(C[k].id)).assignedTo ?? null, at: null }
      : { tasks: await getTasks(C[k].id), at: null };
  }

  // Re-entry (extra): unassign + re-add hot
  let reentry = null;
  if (REENTRY && state.hot.assignedTo) {
    try {
      await removeTags(C.hot.id, ["hot"]);
      await api("PUT", `/contacts/${C.hot.id}`, { body: { assignedTo: "" } });
      const cleared = !(await getContact(C.hot.id)).assignedTo;
      if (!cleared) {
        reentry = { result: "SKIP", detail: "API would not clear assignedTo; re-entry only verifiable in the editor" };
      } else {
        await addTags(C.hot.id, ["hot"]);
        const t1 = Date.now();
        let again = null;
        while (!again && Date.now() - t1 < WAIT_S * 1000) {
          await sleep(5000);
          again = (await getContact(C.hot.id)).assignedTo || null;
        }
        reentry = again
          ? { result: again === sumeetId ? "PASS" : "FAIL", detail: `re-assigned to ${again} after ${Math.round((Date.now() - t1) / 1000)}s` }
          : { result: "FAIL", detail: "second `hot` did not re-assign: Allow re-entry is probably OFF" };
      }
    } catch (e) {
      reentry = { result: "SKIP", detail: String(e.message).slice(0, 140) };
    }
  } else if (REENTRY) {
    reentry = { result: "SKIP", detail: "first `hot` never assigned, nothing to re-enter" };
  }

  // Verdicts
  const rows = [];
  const inboundTasks = state.inbound.tasks;
  const inboundTask = inboundTasks.find((t) => TASK_TITLE_RE.test(t.title ?? "")) ?? inboundTasks[0];
  const inboundFired = Boolean(inboundTask);
  const inboundOk = inboundFired && inboundTask.assignedTo === sumeetId && sameEtDay(inboundTask.dueDate);
  rows.push({
    check: "2 inbound trigger",
    result: inboundOk ? "PASS" : inboundFired ? "FAIL" : "NOTHING FIRED",
    detail: inboundFired
      ? `task "${inboundTask.title}" assignedTo=${inboundTask.assignedTo ?? "-"} (${inboundTask.assignedTo === sumeetId ? "Sumeet" : "NOT Sumeet"}) due=${inboundTask.dueDate ?? "-"} (${sameEtDay(inboundTask.dueDate) ? "today" : "NOT today"}) after ${Math.round(state.inbound.at / 1000)}s`
      : anyPublished
        ? "no task on the consented contact. Causes: workflow not published, Add Task sits behind a wait/window step, or a Send SMS step aborting on a contact with no phone"
        : "no task (workflow in draft)",
  });
  for (const [k, label] of [["g_nosms", "no-sms tag"], ["g_dnc", "dnc tag"], ["g_dnd", "DND all channels"], ["g_smsdnd", "SMS-channel DND (info)"]]) {
    if (!C[k]) continue;
    const got = state[k].tasks.length;
    const info = k === "g_smsdnd";
    rows.push({
      check: `1 guard: ${label}`,
      result: got ? (info ? "PASSED THROUGH" : "FAIL") : inboundFired ? "PASS" : "INCONCLUSIVE",
      detail: got
        ? `task created ("${state[k].tasks[0].title}") — the If/Else guard let this contact through`
        : inboundFired ? "no task: blocked by the guard" : "no task, but the consented contact got none either, so this proves nothing yet",
    });
  }
  for (const k of ["hot", "booked"]) {
    const a = state[k].assignedTo;
    rows.push({
      check: `${k === "hot" ? 3 : 4} ${k} trigger`,
      result: a ? (a === sumeetId ? "PASS" : "FAIL") : "NOTHING FIRED",
      detail: a
        ? `assignedTo=${a} (${a === sumeetId ? "Sumeet" : "NOT Sumeet"}) after ${Math.round(state[k].at / 1000)}s`
        : anyPublished ? "contact never assigned" : "not assigned (workflow in draft)",
    });
  }
  const assignedIds = [state.hot.assignedTo, state.booked.assignedTo, inboundTask?.assignedTo].filter(Boolean);
  rows.push({
    check: "assignment -> Sumeet",
    result: assignedIds.length ? (assignedIds.every((x) => x === sumeetId) ? "PASS" : "FAIL") : "NOTHING FIRED",
    detail: assignedIds.length ? `${assignedIds.length} assignment(s), ${assignedIds.filter((x) => x === sumeetId).length} to ${sumeetId}` : "no assignment to inspect",
  });
  if (reentry) rows.push({ check: "+ re-entry (hot twice)", result: reentry.result, detail: reentry.detail });

  console.log("\n" + pad("check", 33) + pad("result", 16) + "detail");
  for (const r of rows) console.log(pad(r.check, 33) + pad(r.result, 16) + r.detail);
  console.log("\nnot visible over the API: the push notifications, the SMS text, the 9a-8p window branch. Check those in the workflow's execution log.");

  // Cleanup
  if (KEEP) {
    console.log(`\n--keep: ${Object.keys(C).length} test contacts left in GHL (tag ${TEST_TAG}); remove later with --cleanup`);
  } else {
    for (const c of Object.values(C)) await deleteContact(c.id);
    console.log(`\ndeleted ${Object.keys(C).length} test contacts`);
  }
  const bad = rows.filter((r) => r.result === "FAIL").length;
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(2);
});
