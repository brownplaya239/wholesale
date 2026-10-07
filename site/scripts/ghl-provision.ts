/**
 * npm run ghl:provision [-- --dry-run] [--with-extras]
 *
 * Builds the HouseSoldNJ sub-account to src/lib/acq/schema.ts:
 *   - contact + opportunity custom fields          (API)
 *   - both pipelines with their stages              (API)
 *   - Property custom-object fields + association   (API, once the object exists)
 * and verifies what only the UI can do:
 *   - the Property custom object itself (needs an agency token via API)
 *   - workflows, smart lists, conditional required fields
 * Safe to re-run: it only creates what is missing.
 *
 * Needs GHL_TOKEN (sub-account Private Integration Token) + GHL_LOCATION_ID in
 * site/.env.local or the environment. PIT scopes: contacts, opportunities,
 * locations/customFields, objects/schema, objects/record, associations,
 * associations/relation, workflows.readonly, locations.readonly, users.readonly.
 */
import { Ghl } from "../src/lib/acq/ghl";
import {
  CONTACT_FIELDS,
  CONTACT_PROPERTY_ASSOCIATION,
  fieldKey,
  OPPORTUNITY_FIELDS,
  PIPELINES,
  PROPERTY_OBJECT,
  WORKFLOWS,
  type PipelineKey,
} from "../src/lib/acq/schema";
import { findPropertyObject, matchFields, matchPropertyFields, matchStages, resolve } from "../src/lib/acq/sync";
import { loadEnv } from "./env";

loadEnv();
const dry = process.argv.includes("--dry-run");
const withExtras = process.argv.includes("--with-extras");
const token = process.env.GHL_TOKEN;
const locationId = process.env.GHL_LOCATION_ID;
if (!token || !locationId) {
  console.error("Set GHL_TOKEN and GHL_LOCATION_ID (site/.env.local).");
  process.exit(1);
}
const ghl = new Ghl({ token, locationId });
const todo: string[] = [];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function fields(model: "contact" | "opportunity", defs: typeof CONTACT_FIELDS) {
  const existing = await ghl.listFields(model);
  const { missing } = matchFields(existing, defs, model);
  console.log(`${model} fields: ${defs.length - missing.length}/${defs.length} present`);
  for (const m of missing) {
    const def = defs.find((d) => `${model}: ${d.name}` === m)!;
    if (dry) {
      console.log(`  would create ${m} (${def.type})`);
      continue;
    }
    try {
      await ghl.createField(model, { name: def.name, dataType: def.type, options: def.options });
      console.log(`  created ${m}`);
    } catch (e) {
      console.log(`  FAILED ${m}: ${String(e).slice(0, 200)}`);
      todo.push(`Create ${model} field "${def.name}" (${def.type}${def.options ? `: ${def.options.join(" | ")}` : ""}) in Settings → Custom Fields`);
    }
  }
}

async function pipelines() {
  const existing = await ghl.listPipelines();
  for (const key of Object.keys(PIPELINES) as PipelineKey[]) {
    const want = PIPELINES[key];
    const have = existing.find((p) => norm(p.name) === norm(want.name));
    if (!have) {
      if (dry) console.log(`pipeline "${want.name}": would create with ${want.stages.length} stages`);
      else {
        await ghl.createPipeline(want.name, want.stages);
        console.log(`pipeline "${want.name}": created`);
      }
      continue;
    }
    // matched ignoring spaces/punctuation + aliases — a hand-built pipeline is fine as is
    const m = matchStages(key, have.stages);
    console.log(`pipeline "${want.name}": present, ${m.stages.size}/${want.stages.length} stages matched${m.missing.length ? ` — MISSING: ${m.missing.join(", ")}` : ""}`);
    if (m.missing.length) {
      todo.push(`Pipeline "${want.name}": add or rename stages ${m.missing.map((s) => `"${s}"`).join(", ")} in Opportunities → Pipelines`);
    }
  }
}

async function propertyObject() {
  const obj = await findPropertyObject(ghl);
  if (!obj.key) {
    console.log(`custom object "${PROPERTY_OBJECT.singular}": NOT FOUND`);
    todo.push(
      `Settings → Objects → Create custom object: singular "Property", plural "Properties", primary display field "${PROPERTY_OBJECT.primary.name}" (text). Then re-run this script. (If it exists under another key, set GHL_PROPERTY_OBJECT_KEY.)`
    );
    return;
  }
  const { map, missing } = matchPropertyFields(obj.fields);
  const core = PROPERTY_OBJECT.fields.filter((f) => f.tier === "core");
  console.log(`custom object ${obj.key}: found; ${obj.fields.length} live fields`);
  console.log(`  your build (core): ${core.filter((f) => map.has(f.id)).length}/${core.length} mapped${map.has(PROPERTY_OBJECT.primary.id) ? " + primary" : " — primary NOT mapped"}`);
  for (const f of core.filter((d) => map.has(d.id))) {
    const live = map.get(f.id)!;
    console.log(`    ${f.id.padEnd(20)} -> "${live.name}" (${live.dataType}${live.options.length ? `: ${live.options.map((o) => o.label).join(" | ")}` : ""})`);
  }
  for (const f of missing.filter((d) => d.tier === "core")) {
    console.log(`    ${f.id.padEnd(20)} -> NOT FOUND (looked for "${f.name}"${f.aliases ? `, ${f.aliases.map((a) => `"${a}"`).join(", ")}` : ""})`);
    todo.push(`Property object: no field named "${f.name}" — rename yours to match, or tell Claude its label (core fields are never auto-created, to avoid duplicates)`);
  }
  const toAdd = missing.filter((d) => d.tier === "required" || (withExtras && d.tier === "extra"));
  const skipped = missing.filter((d) => d.tier === "extra" && !withExtras);
  if (skipped.length) console.log(`  extras not added (use --with-extras): ${skipped.map((d) => d.name).join(", ")}`);
  let folder = obj.folders.find((f) => norm(f.name) === norm("Acquisition System"))?.id;
  if (toAdd.length && !folder && !dry) {
    const f = await ghl.createObjectFolder(obj.key, "Acquisition System").catch(() => null);
    folder = f?.id ?? f?.folder?.id ?? obj.folders[0]?.id;
  }
  for (const d of toAdd) {
    if (dry || !folder) {
      console.log(`  ${dry ? "would add" : "cannot add (no folder)"} ${d.name} (${d.type}, ${d.tier})`);
      if (!dry) todo.push(`Property object: add field "${d.name}" (${d.type})`);
      continue;
    }
    try {
      await ghl.createObjectField(obj.key, folder, { name: d.name, key: fieldKey(d.name), dataType: d.type, options: d.options });
      console.log(`  added ${d.name} (${d.tier})`);
    } catch (e) {
      console.log(`  FAILED ${d.name}: ${String(e).slice(0, 200)}`);
      todo.push(`Property object: add field "${d.name}" (${d.type}${d.options ? `: ${d.options.join(" | ")}` : ""})`);
    }
  }
  todo.push(`Property object: mark "Acq Property ID" searchable (the push script finds records by it).`);

  const assoc = await ghl.listAssociations();
  const found = (assoc.associations ?? []).some(
    (a) => a.key === CONTACT_PROPERTY_ASSOCIATION.key || ([a.firstObjectKey, a.secondObjectKey].includes(obj.key!) && [a.firstObjectKey, a.secondObjectKey].includes("contact"))
  );
  if (found) console.log("association contact <-> property: present");
  else if (dry) console.log("association contact <-> property: would create");
  else {
    await ghl.createAssociation({
      key: CONTACT_PROPERTY_ASSOCIATION.key,
      firstObjectLabel: CONTACT_PROPERTY_ASSOCIATION.second,
      firstObjectKey: obj.key,
      secondObjectLabel: CONTACT_PROPERTY_ASSOCIATION.first,
      secondObjectKey: "contact",
    });
    console.log("association contact <-> property: created");
  }
}

async function workflows() {
  const wf = await ghl.listWorkflows().catch(() => []);
  for (const w of WORKFLOWS) {
    const have = wf.find((x) => norm(x.name) === norm(w.name));
    console.log(`workflow "${w.name}": ${have ? `present (${have.status ?? "?"})` : "MISSING"}`);
    if (!have) todo.push(`Workflow "${w.name}" — trigger: ${w.trigger}; actions: ${w.actions}`);
    else if (have.status && have.status !== "published") todo.push(`Publish workflow "${w.name}"`);
  }
}

async function main() {
  console.log(`HighLevel location ${locationId}${dry ? " (dry run)" : ""}\n`);
  await fields("contact", CONTACT_FIELDS);
  await fields("opportunity", OPPORTUNITY_FIELDS);
  await pipelines();
  await propertyObject();
  await workflows();
  const r = await resolve(ghl, { fresh: true });
  console.log(`\nResolver: ${r.missing.length ? `${r.missing.length} unresolved — ${r.missing.slice(0, 8).join("; ")}` : "everything resolves"}`);
  todo.push(
    `Settings → Objects → Opportunities: enable "Allow Multiple Opportunities per Contact"`,
    `Labs → enable "Show & Require Opportunity Fields Conditionally"; require the qualification fields on stages Qualified Warm / Qualified Hot / Qualified (list in docs/ACQUISITION_SYSTEM.md)`,
    `Smart lists + WAVV settings: docs/ACQUISITION_SYSTEM.md §5-6`
  );
  console.log(`\nManual steps (${todo.length}):`);
  todo.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
