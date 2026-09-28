/**
 * The property report as an email — the whole report inline (HTML, with a
 * plain-text twin), so it reads without logging in. The admin page keeps the
 * interactive parts: editable worksheet, photos, Street View, pipeline stage.
 * Internal only; goes to LEAD_ALERT_TO, never to a seller.
 */
import { lastNameMatches, type Workflow } from "@/lib/enrich/insights";
import type { MlsListing } from "@/lib/enrich/mls";
import type { Dossier, SourceRef } from "@/lib/enrich/types";
import { computeWorksheet, defaultWorksheet } from "@/lib/enrich/worksheet";
import { leadSubject, reportUrl } from "./notify";
import type { LeadRecord } from "./store";

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const k = (n: number | null | undefined) => (n == null ? "—" : n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}k`);
const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const SHORT: Record<string, string> = {
  nj_sr1a: "deed record",
  nj_parcels_modiv: "tax list",
  mls: "MLS",
  seller: "seller",
  fema_nfhl: "FEMA",
  nj_geocoder: "NJ geocoder",
  census_geocoder: "Census geocoder",
  comps: "deeds + MLS",
};
const short = (s: SourceRef | null | undefined) => (s ? (SHORT[s.id] ?? s.name) : "");

export type ReportNumbers = {
  asIs: number;
  arv: number | null;
  repairs: number;
  repairBasis: string;
  maxCash: number | null;
  assignment: number | null;
  assignmentFee: number;
  listingNet: number | null;
};

/** Worksheet defaults (the same ones the report page opens with). */
export function reportNumbers(d: Dossier, condition: string | null): ReportNumbers | null {
  const ws = defaultWorksheet(d, condition);
  if (ws.inputs.asIsValue == null) return null;
  const r = computeWorksheet(ws.inputs);
  const i = ws.inputs;
  return {
    asIs: i.asIsValue!,
    arv: i.arv,
    repairs: r.repairs,
    repairBasis: `${condition ? `"${condition}"` : "condition not reported"}${i.livingSpace ? ` · $${i.repairPerSqft}/sq ft` : ""}`,
    maxCash: r.maxPurchase,
    assignment: r.wholesaleOffer,
    assignmentFee: i.assignmentFee,
    listingNet: r.listingNet,
  };
}

function listingLine(l: MlsListing, withAddress: boolean): string {
  const price = l.closePrice ? `sold ${money(l.closePrice)}${l.listPrice ? ` (list ${money(l.listPrice)})` : ""}` : money(l.listPrice);
  const when = l.closeDate ? l.closeDate : l.listDate ? `listed ${l.listDate}` : "";
  return [
    withAddress ? `${l.address.split(",")[0]}${l.unit ? ` #${l.unit}` : ""}` : null,
    l.status,
    price,
    `${l.beds ?? "?"} bd / ${l.baths ?? "?"} ba`,
    l.sqft ? `${l.sqft.toLocaleString()} sf` : null,
    when,
    l.daysOnMarket != null ? `${l.daysOnMarket} DOM` : null,
    withAddress && l.distanceMi != null ? `${l.distanceMi} mi` : null,
    withAddress ? null : l.office,
  ]
    .filter(Boolean)
    .join(" · ");
}

function nearbyOf(d: Dossier) {
  const all = d.mls?.nearby.status === "ok" ? (d.mls.nearby.data ?? []) : [];
  const beds = d.characteristics.bedrooms.value;
  const similar = beds ? all.filter((l) => l.beds != null && Math.abs(l.beds - beds) <= 1) : [];
  const asking = (ls: MlsListing[]) => ls.flatMap((l) => (l.listPrice ? [l.listPrice] : []));
  const range = (ls: MlsListing[]) => {
    const a = asking(ls);
    return a.length ? `${k(Math.min(...a))}–${k(Math.max(...a))}` : null;
  };
  const summary = all.length
    ? `${all.length} active/pending within 1.5 mi${
        beds && similar.length
          ? ` · ${similar.length} with ${beds - 1}–${beds + 1} bd asking ${range(similar)}`
          : range(all)
            ? ` asking ${range(all)}`
            : ""
      }`
    : null;
  return { all, similar, summary, show: (similar.length ? similar : all).slice(0, 6) };
}

type Model = ReturnType<typeof model>;

function model(lead: LeadRecord, d: Dossier, workflow: Workflow | null, reason: string) {
  const g = d.geocode.data;
  const p = d.parcel.data;
  const c = d.comps.data;
  const v = c?.valuation ?? null;
  const ch = d.characteristics;
  const listed = d.mls?.subject.data?.activeListing ?? null;
  const owner = p?.owner.name
    ? `${p.owner.name} — ${lastNameMatches(lead.name, p.owner.name) ? "matches the seller" : "doesn't match the seller: confirm authority to sell"}`
    : null;
  const size = [
    ch.bedrooms.value != null || ch.bathrooms.value != null
      ? `${ch.bedrooms.value ?? "?"} bd / ${ch.bathrooms.value ?? "?"} ba (${short(ch.bedrooms.source ?? ch.bathrooms.source)})`
      : null,
    ch.livingSpace.value ? `${ch.livingSpace.value.toLocaleString()} sq ft (${short(ch.livingSpace.source)})` : null,
    ch.yearBuilt.value ? `built ${ch.yearBuilt.value}` : null,
    ch.lotAcres.value ? `${ch.lotAcres.value.toFixed(2)} ac` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const deed = d.history.data?.[0];
  const facts: [string, string][] = [
    ["Address", g ? `${g.standardized} (${g.match.replace("_", " ")} match)` : `NOT VERIFIED — ${lead.addressCurrent}`],
    ...(lead.addressUnit ? ([["Unit", `${lead.addressUnit} (${d.unit.status.replace("_", " ")})`]] as [string, string][]) : []),
    ...(p
      ? ([
          ["Parcel", `${p.municipality}, ${p.county} County — Block ${p.block} Lot ${p.lot}${p.qualifier ? ` Qual ${p.qualifier}` : ""}`],
          ["Type", `${p.propClassLabel}${p.dwellings && p.dwellings > 1 ? ` · ${p.dwellings} dwellings` : ""}`],
        ] as [string, string][])
      : []),
    ...(size ? ([["Size", size]] as [string, string][]) : []),
    ...(owner ? ([["Owner of record", owner]] as [string, string][]) : []),
    ...(p?.owner.mailing ? ([["Owner mailing", `${p.owner.mailing}${p.owner.absentee ? " (absentee)" : ""}`]] as [string, string][]) : []),
    ...(p?.lastYearTaxes ? ([["Taxes", `${money(p.lastYearTaxes)}/yr · assessed ${money(p.assessed.net)}`]] as [string, string][]) : []),
    ...(d.flood.data
      ? ([["Flood", `Zone ${d.flood.data.zone}${d.flood.data.sfha ? " — SPECIAL FLOOD HAZARD AREA" : ""}`]] as [string, string][])
      : []),
    ...(deed ? ([["Last deed", `${deed.date} ${money(deed.price)}${deed.usable ? "" : ` — ${deed.nuLabel ?? "non-usable"}`}`]] as [string, string][]) : []),
  ];
  const seller: [string, string][] = (
    [
      ["Timeline", lead.timeline],
      ["Priority", lead.priority],
      ["Condition", lead.condition],
      ["Occupancy", lead.occupancy],
      ["Beds / baths", lead.beds || lead.baths ? `${lead.beds ?? "?"} bd / ${lead.baths ?? "?"} ba` : null],
      ["Email", lead.email],
      ["Notes", lead.notes],
    ] as [string, string | null][]
  ).filter((x): x is [string, string] => Boolean(x[1]));
  return {
    subject: `Re: ${leadSubject(lead.name, lead.addressOriginal)}`,
    intro: reason === "address_changed" ? "Updated property report — the seller edited the address/unit." : "Property report",
    title: g?.standardized ?? lead.addressCurrent,
    lead,
    listed,
    v,
    comps: c?.comps ?? [],
    compsNote: d.comps.note ?? c?.note ?? null,
    pool: c?.pool ?? null,
    numbers: reportNumbers(d, lead.condition),
    facts,
    seller,
    mlsHistory: d.mls?.subject.data?.records ?? [],
    nearby: nearbyOf(d),
    risks: d.insights.risks,
    missing: d.insights.missing,
    workflow,
    url: reportUrl(lead.id),
    maps: g ? `https://www.google.com/maps/search/?api=1&query=${g.lat},${g.lng}` : null,
    streetView: g ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${g.lat},${g.lng}` : null,
  };
}

function toText(m: Model): string {
  const out: (string | null | false | undefined)[] = [
    `${m.intro}: ${m.title}`,
    m.listed &&
      `⚠ CURRENTLY ${m.listed.status!.toUpperCase()} in the MLS${m.listed.office ? ` with ${m.listed.office}` : ""} — another broker's listing unless it's yours. Confirm status/expiration first.`,
    "",
    "ESTIMATES — for your review",
    m.v
      ? `Value: ${money(m.v.low)}–${money(m.v.high)} (${m.v.confidence} confidence) from ${m.comps.length} comps`
      : `Value: no comp range — ${m.compsNote ?? "not enough comparable sales"}`,
    m.v?.ownSale &&
      `Own sale: ${m.v.ownSale.date} ${money(m.v.ownSale.price)} (${m.v.ownSale.source}) — ${m.v.ownSale.inRange ? "consistent with the range" : m.v.ownSale.price < m.v.low ? "BELOW the range" : "ABOVE the range"}`,
    m.numbers &&
      `Max cash offer (flip math): ${money(m.numbers.maxCash)} · Assignment offer: ${money(m.numbers.assignment)} · Seller's net if listed as-is: ${money(m.numbers.listingNet)}`,
    m.numbers && `Repairs assumed: ${money(m.numbers.repairs)} (${m.numbers.repairBasis})`,
    "",
    "PROPERTY",
    ...m.facts.map(([a, b]) => `${a}: ${b}`),
    ...(m.mlsHistory.length ? ["MLS history:", ...m.mlsHistory.slice(0, 4).map((l) => `  • ${listingLine(l, false)}`)] : []),
    ...(m.seller.length ? ["", "SELLER'S ANSWERS", ...m.seller.map(([a, b]) => `${a}: ${b}`)] : []),
    "",
    `COMPARABLE SALES (${m.comps.length})`,
    ...m.comps.map(
      (c) =>
        `• ${c.address}${c.municipality ? `, ${c.municipality}` : ""} — ${c.saleDate} ${money(c.price)}${c.livingSpace ? ` · ${c.livingSpace.toLocaleString()} sf` : ""}${c.beds != null ? ` · ${c.beds}/${c.baths ?? "?"}` : ""}${c.distanceMi != null ? ` · ${c.distanceMi} mi` : ""}${c.source === "mls" ? " [MLS]" : ""}`
    ),
    ...(m.nearby.summary ? ["", `FOR SALE NEARBY — ${m.nearby.summary}`, ...m.nearby.show.map((l) => `• ${listingLine(l, true)}`)] : []),
    ...(m.risks.length ? ["", "WATCH", ...m.risks.map((r) => `• ${r}`)] : []),
    ...(m.missing.length ? ["", "ASK ON THE CALL", ...m.missing.map((r) => `• ${r}`)] : []),
    ...(m.workflow
      ? ["", `NEXT STEPS — ${m.workflow.label}`, `First touch: ${m.workflow.firstTouch}`, ...m.workflow.steps.map((s, i) => `${i + 1}. ${s}`)]
      : []),
    "",
    `Worksheet, photos, Street View: ${m.url}`,
    "Internal only — estimates need your review; nothing is sent to the seller automatically.",
  ];
  return out.filter((l): l is string => typeof l === "string").join("\n");
}

const C = { ink: "#1c2b39", soft: "#51616f", line: "#e5e1d8", accent: "#b45309", cream: "#faf9f6", red: "#991b1b", green: "#15803d" };
const h2 = (t: string) =>
  `<h2 style="margin:22px 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:${C.soft}">${esc(t)}</h2>`;
const td = (v: string, extra = "") => `<td style="padding:5px 8px 5px 0;border-top:1px solid ${C.line};vertical-align:top;${extra}">${v}</td>`;

function toHtml(m: Model): string {
  const kv = (rows: [string, string][]) =>
    `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows
      .map(([a, b]) => `<tr>${td(esc(a), `color:${C.soft};width:34%`)}${td(esc(b))}</tr>`)
      .join("")}</table>`;
  const list = (items: string[], color = C.ink) =>
    `<ul style="margin:0;padding-left:18px;font-size:14px;color:${color}">${items.map((i) => `<li style="margin:3px 0">${esc(i)}</li>`).join("")}</ul>`;
  const parts: string[] = [];
  parts.push(
    `<p style="margin:0;font-size:12px;color:${C.soft};text-transform:uppercase;letter-spacing:.06em">${esc(m.intro)} · internal</p>`,
    `<h1 style="margin:4px 0 2px;font-size:21px;line-height:1.25">${esc(m.title)}</h1>`,
    `<p style="margin:0;font-size:14px;color:${C.soft}">${esc(m.lead.name)} · <a href="tel:+1${m.lead.phone.replace(/\D/g, "")}" style="color:${C.accent}">${esc(m.lead.phone)}</a></p>`
  );
  if (m.listed) {
    parts.push(
      `<p style="margin:14px 0 0;padding:10px 12px;border-radius:8px;background:#fef2f2;color:${C.red};font-size:14px"><strong>Currently ${esc(m.listed.status)} in the MLS</strong>${m.listed.office ? ` with ${esc(m.listed.office)}` : ""}${m.listed.listPrice ? ` at ${money(m.listed.listPrice)}` : ""}. Unless it's your listing, don't interfere — confirm status and expiration first.</p>`
    );
  }

  // Estimates
  const est: string[] = [];
  if (m.v) {
    est.push(
      `<p style="margin:0;font-size:12px;color:${C.soft}">Preliminary as-is value · ${esc(m.v.confidence)} confidence · ${m.comps.length} comps</p>`,
      `<p style="margin:2px 0 0;font-size:26px;font-weight:800">${money(m.v.low)} – ${money(m.v.high)}</p>`
    );
    if (m.v.ownSale) {
      const o = m.v.ownSale;
      est.push(
        `<p style="margin:8px 0 0;font-size:14px;color:${o.inRange ? C.green : C.red}">This property sold ${esc(o.date)} for <strong>${money(o.price)}</strong> (${esc(o.source)}) — ${o.inRange ? "consistent with the range." : `${o.price < m.v.low ? "below" : "above"} the range; weigh that sale heavily.`}</p>`
      );
    }
  } else {
    est.push(`<p style="margin:0;font-size:14px">No comp range — ${esc(m.compsNote ?? "not enough comparable sales")}.</p>`);
  }
  if (m.numbers) {
    const n = m.numbers;
    est.push(
      `<table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px">
        <tr>${td("Max cash offer <span style='color:" + C.soft + "'>(flip math)</span>")}${td(`<strong>${money(n.maxCash)}</strong>`, "text-align:right")}</tr>
        <tr>${td(`Assignment offer <span style='color:${C.soft}'>(− ${k(n.assignmentFee)} fee)</span>`)}${td(`<strong>${money(n.assignment)}</strong>`, "text-align:right")}</tr>
        <tr>${td("Seller's net if listed as-is")}${td(`<strong>${money(n.listingNet)}</strong>`, "text-align:right")}</tr>
        <tr>${td(`<span style="color:${C.soft}">Repairs assumed: ${money(n.repairs)} (${esc(n.repairBasis)}) · ARV ${money(n.arv)}</span>`, "font-size:12px")}${td("")}</tr>
      </table>`
    );
  }
  parts.push(
    `<div style="margin-top:16px;padding:14px;border:1px solid #fcd34d;border-radius:10px;background:#fffbeb">${est.join("")}<p style="margin:8px 0 0;font-size:11px;color:${C.soft}">Estimates for your review, from the worksheet's default assumptions — adjust them on the report page.</p></div>`
  );

  parts.push(h2("Property"), kv(m.facts));
  if (m.mlsHistory.length) parts.push(h2("MLS history"), list(m.mlsHistory.slice(0, 5).map((l) => listingLine(l, false))));
  if (m.seller.length) parts.push(h2("Seller's answers"), kv(m.seller));

  parts.push(h2(`Comparable sales (${m.comps.length})`));
  if (m.comps.length) {
    parts.push(
      `<table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="color:${C.soft};font-size:11px;text-align:left"><th style="padding-bottom:4px">Address</th><th>Sold</th><th>Price</th><th>Size</th></tr>${m.comps
        .map(
          (c) =>
            `<tr>${td(`<strong>${esc(c.address)}</strong><br><span style="color:${C.soft};font-size:12px">${esc(c.municipality ?? "")}${c.distanceMi != null ? ` · ${c.distanceMi} mi` : ""}${c.source === "mls" ? " · MLS" : ""}</span>`)}${td(esc(c.saleDate), "white-space:nowrap")}${td(`${money(c.price)}${c.ppsf ? `<br><span style="color:${C.soft};font-size:12px">$${c.ppsf}/sf</span>` : ""}`)}${td(`${c.livingSpace ? c.livingSpace.toLocaleString() + " sf" : "—"}${c.beds != null ? `<br><span style="color:${C.soft};font-size:12px">${c.beds} bd / ${c.baths ?? "?"} ba</span>` : ""}`)}</tr>`
        )
        .join("")}</table>`
    );
    if (m.v) parts.push(`<p style="margin:6px 0 0;font-size:12px;color:${C.soft}">${esc(m.v.method)}. ${esc(m.v.reasons.join(" · "))}</p>`);
  } else {
    parts.push(`<p style="margin:0;font-size:14px;color:${C.soft}">${esc(m.compsNote ?? "None found.")}</p>`);
  }

  if (m.nearby.summary) parts.push(h2("For sale nearby"), `<p style="margin:0 0 4px;font-size:13px;color:${C.soft}">${esc(m.nearby.summary)}</p>`, list(m.nearby.show.map((l) => listingLine(l, true))));
  if (m.risks.length) parts.push(h2("Watch"), list(m.risks, C.red));
  if (m.missing.length) parts.push(h2("Ask on the call"), list(m.missing));
  if (m.workflow) {
    parts.push(
      h2(`Next steps — ${m.workflow.label}`),
      `<p style="margin:0 0 4px;font-size:14px"><strong>First touch:</strong> ${esc(m.workflow.firstTouch)}</p>`,
      `<ol style="margin:0;padding-left:20px;font-size:14px">${m.workflow.steps.map((s) => `<li style="margin:3px 0">${esc(s)}</li>`).join("")}</ol>`
    );
  }
  parts.push(
    `<p style="margin:24px 0 0"><a href="${esc(m.url)}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:${C.accent};color:#fff;font-weight:700;text-decoration:none">Open worksheet, photos &amp; Street View</a></p>`,
    `<p style="margin:10px 0 0;font-size:13px">${m.maps ? `<a href="${esc(m.maps)}" style="color:${C.accent}">Map</a>` : ""}${m.streetView ? ` · <a href="${esc(m.streetView)}" style="color:${C.accent}">Street View</a>` : ""}</p>`,
    `<p style="margin:16px 0 0;font-size:11px;color:${C.soft}">Internal only — estimates need your review; nothing is sent to the seller automatically.</p>`
  );
  return `<!doctype html><html><body style="margin:0;background:${C.cream}"><div style="max-width:640px;margin:0 auto;padding:20px 16px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${C.ink};background:#fff">${parts.join("\n")}</div></body></html>`;
}

/** The enriched follow-up — threads under the original lead email ("Re:"). */
export function enrichedEmail(
  lead: LeadRecord,
  d: Dossier,
  reason: string,
  workflow: Workflow | null = lead.workflow
): { subject: string; text: string; html: string } {
  const m = model(lead, d, workflow, reason);
  return { subject: m.subject, text: toText(m), html: toHtml(m) };
}

/**
 * For the "More from…" email: what the seller's new answers change — the
 * follow-up track, the repair-based offer numbers, beds/baths disagreements.
 */
export function answersUpdate(lead: LeadRecord, d: Dossier | null, workflow: Workflow | null, changed: string[]): string[] {
  if (!d || !changed.some((c) => ["condition", "timeline", "priority", "beds", "baths"].includes(c))) return [];
  const lines: string[] = ["", "Updated with these answers:"];
  if (workflow) lines.push(`• Follow-up: ${workflow.label} — ${workflow.steps[0] ?? workflow.firstTouch}`);
  const n = reportNumbers(d, lead.condition);
  if (n && changed.includes("condition")) {
    lines.push(
      `• Repairs for ${n.repairBasis}: ${money(n.repairs)} → max cash offer ${money(n.maxCash)} · assignment offer ${money(n.assignment)} · listing net ${money(n.listingNet)}`
    );
  }
  for (const c of d.conflicts.filter((x) => x.field === "bedrooms" || x.field === "bathrooms")) {
    lines.push(`• ${c.field}: ${c.values.map((x) => `${x.value} (${x.source})`).join(" vs ")} — confirm on the call`);
  }
  return lines.length > 2 ? lines : [];
}
