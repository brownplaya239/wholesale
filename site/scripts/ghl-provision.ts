/**
 * npm run ghl:provision [-- --dry-run]
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
 * associations/relation, workflows.readonly, locations.readonly.
 */
import { Ghl, GhlError } from "../src/lib/acq/ghl";
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
import { matchFields, resolve } from "../src/lib/acq/sync";
import { loadEnv } from "./env";

loadEnv();
const dry = process.argv.includes("--dry-run");
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
    const names = have.stages.map((s) => s.name);
    const missing = want.stages.filter((s) => !names.includes(s));
    console.log(`pipeline "${want.name}": present, ${missing.length ? `MISSING stages: ${missing.join(", ")}` : "all stages present"}`);
    if (missing.length) {
      todo.push(`Pipeline "${want.name}": add stages ${missing.map((s) => `"${s}"`).join(", ")} (exact spelling) in Opportunities → Pipelines`);
    }
  }
}

async function propertyObject() {
  try {
    await ghl.getObject(PROPERTY_OBJECT.key);
  } catch (e) {
    if (e instanceof GhlError && (e.status === 404 || e.status === 400)) {
      console.log(`custom object ${PROPERTY_OBJECT.key}: NOT FOUND`);
      todo.push(
        `Settings → Objects → Create custom object: singular "Property", plural "Properties", key "property" (→ ${PROPERTY_OBJECT.key}), primary display field "${PROPERTY_OBJECT.primary.name}" (text). Then re-run this script.`
      );
      return;
    }
    throw e;
  }
  const res = await ghl.listObjectFields(PROPERTY_OBJECT.key);
  const have = res.fields ?? [];
  const missing = PROPERTY_OBJECT.fields.filter(
    (d) => !have.some((f) => f.fieldKey === `${PROPERTY_OBJECT.key}.${fieldKey(d.name)}` || norm(f.name) === norm(d.name))
  );
  console.log(`Property fields: ${PROPERTY_OBJECT.fields.length - missing.length}/${PROPERTY_OBJECT.fields.length} present`);
  let folder = res.folders?.[0]?.id;
  if (missing.length && !folder && !dry) {
    const f = await ghl.createObjectFolder(PROPERTY_OBJECT.key, "Acquisition").catch(() => null);
    folder = f?.id ?? f?.folder?.id;
  }
  for (const d of missing) {
    if (dry || !folder) {
      console.log(`  ${dry ? "would create" : "cannot create (no folder)"} ${d.name} (${d.type})`);
      if (!dry) todo.push(`Property object: add field "${d.name}" (${d.type})`);
      continue;
    }
    try {
      await ghl.createObjectField(PROPERTY_OBJECT.key, folder, { name: d.name, key: fieldKey(d.name), dataType: d.type, options: d.options });
      console.log(`  created ${d.name}`);
    } catch (e) {
      console.log(`  FAILED ${d.name}: ${String(e).slice(0, 200)}`);
      todo.push(`Property object: add field "${d.name}" (${d.type}${d.options ? `: ${d.options.join(" | ")}` : ""})`);
    }
  }
  todo.push(`Property object: mark "Acq Property ID" searchable (the push script finds records by it).`);

  const assoc = await ghl.listAssociations();
  const found = (assoc.associations ?? []).some(
    (a) => a.key === CONTACT_PROPERTY_ASSOCIATION.key || [a.firstObjectKey, a.secondObjectKey].includes(PROPERTY_OBJECT.key)
  );
  if (found) console.log("association contact <-> property: present");
  else if (dry) console.log("association contact <-> property: would create");
  else {
    await ghl.createAssociation({
      key: CONTACT_PROPERTY_ASSOCIATION.key,
      firstObjectLabel: CONTACT_PROPERTY_ASSOCIATION.second,
      firstObjectKey: PROPERTY_OBJECT.key,
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
