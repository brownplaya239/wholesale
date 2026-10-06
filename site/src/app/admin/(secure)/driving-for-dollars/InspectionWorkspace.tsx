"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addressKey, csvProperty, emptyReview, inspectionScore, parseCsv, propertyInput, type InspectionProperty, type InspectionReview, type PropertyInput } from "@/lib/inspection/model";
import InspectionMap from "./InspectionMap";

const field = "mt-1 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink";
const button = "rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:bg-cream disabled:opacity-50";
async function request(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Request failed. Please retry.");
  return body;
}
const safeLink = (url: string | null) => { try { const u = new URL(url || ""); return ["https:", "http:"].includes(u.protocol) ? u.href : null; } catch { return null; } };
type Filter = "all" | "unreviewed" | "unresolved" | "sheriff" | "tenure" | "flood";

export default function InspectionWorkspace({ databaseConfigured, initialProperty, googleScoringAllowed }: { databaseConfigured: boolean; initialProperty: PropertyInput | null; googleScoringAllowed: boolean }) {
  const [properties, setProperties] = useState<InspectionProperty[]>([]); const [selectedId, setSelectedId] = useState("");
  const [review, setReview] = useState<InspectionReview>(emptyReview); const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState<Filter>("all"); const [query, setQuery] = useState(""); const [batch, setBatch] = useState("all");
  const [order, setOrder] = useState("research"); const [limit, setLimit] = useState(50); const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(databaseConfigured); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  const [rings, setRings] = useState<[number, number][][] | null>(null); const [parcelNote, setParcelNote] = useState("");
  const [preview, setPreview] = useState<PropertyInput[] | null>(null); const fileInput = useRef<HTMLInputElement>(null);
  const selected = properties.find((p) => p.id === selectedId) ?? null;
  const reload = useCallback(async () => {
    if (!databaseConfigured) return;
    setLoading(true);
    try { const data = await request("/api/admin/inspection"); setProperties(data.properties); setError(""); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }, [databaseConfigured]);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  useEffect(() => {
    const controller = new AbortController(); setRings(null); setParcelNote("");
    if (selected && (selected.objectId || selected.pin)) {
      request(`/api/admin/inspection/${selected.id}/parcel`, { signal: controller.signal }).then((r) => {
        if (!controller.signal.aborted) { setRings(r.rings); setParcelNote(r.note || `${r.attributes?.MUN_NAME ?? selected.city} · block ${r.attributes?.PCLBLOCK ?? selected.block} / lot ${r.attributes?.PCLLOT ?? selected.lot}. Tax boundaries are not a survey.`); }
      }).catch((e) => { if (!controller.signal.aborted) setParcelNote((e as Error).message); });
    }
    return () => controller.abort();
  }, [selected?.id, selected?.pin, selected?.objectId]);

  const choose = (id: string) => {
    if (id === selectedId) return;
    if (dirty && !window.confirm("Discard the unsaved inspection changes?")) return;
    const p = properties.find((p) => p.id === id); setSelectedId(id); setReview(p?.review ?? emptyReview()); setDirty(false); setError(""); setMessage("");
  };
  const update = <K extends keyof InspectionReview>(key: K, value: InspectionReview[K]) => { setReview((r) => ({ ...r, [key]: value })); setDirty(true); setMessage(""); };
  const batches = [...new Set(properties.map((p) => p.batch))].sort();
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase();
    const found = properties.filter((p) => (batch === "all" || p.batch === batch) && (!search || `${p.address} ${p.city} ${p.county} ${p.sourceIds.join(" ")} ${p.block} ${p.lot}`.toLowerCase().includes(search)) && (
      filter === "all" || filter === "unreviewed" && !p.reviewedAt || filter === "unresolved" && p.locationStatus !== "matched" || filter === "sheriff" && p.sheriffDate || filter === "tenure" && !p.tenureConflict && (p.tenureYears ?? 0) >= 5 || filter === "flood" && p.floodSfha?.toLowerCase().startsWith("yes")
    ));
    return found.sort((a, b) => {
      const sa = inspectionScore(a, a.review, googleScoringAllowed); const sb = inspectionScore(b, b.review, googleScoringAllowed);
      if (order === "distress") return (sb.score ?? -1) - (sa.score ?? -1) || sb.proxy - sa.proxy || a.address.localeCompare(b.address);
      if (order === "priority") return (sb.priority ?? -1) - (sa.priority ?? -1) || sb.proxy - sa.proxy;
      const group = (p: InspectionProperty) => p.sheriffDate ? 0 : p.historicTaxAmount !== null ? 1 : p.locationStatus === "matched" ? 2 : 3;
      return group(a) - group(b) || (a.sheriffDate || "9999").localeCompare(b.sheriffDate || "9999") || sb.proxy - sa.proxy || a.address.localeCompare(b.address);
    });
  }, [properties, query, batch, filter, order, googleScoringAllowed]);
  const stats = { located: properties.filter((p) => p.lat !== null && p.lng !== null).length, reviewed: properties.filter((p) => p.reviewedAt).length, complete: properties.filter((p) => inspectionScore(p, p.review, googleScoringAllowed).score !== null).length };
  const score = selected ? inspectionScore(selected, review, googleScoringAllowed) : null;
  const previewUnique = preview ? new Set(preview.map((p) => addressKey(p.address, p.city))).size : 0;

  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 3_500_000) { setError("Import a CSV or assessment JSON smaller than 3.5 MB."); return; }
    setError(""); setMessage("");
    try {
      const raw = await file.text(); let rows: PropertyInput[];
      if (/\.json$/i.test(file.name)) {
        const json = JSON.parse(raw); const input = Array.isArray(json) ? json : json.rows;
        if (!Array.isArray(input) || input.length > 10000) throw new Error("JSON must contain a rows array with at most 10,000 entries.");
        rows = input.map((row) => propertyInput.parse(row));
      } else rows = parseCsv(raw).map((row) => csvProperty(row, file.name.replace(/\.csv$/i, "")));
      if (!rows.length) throw new Error("No property rows found.");
      setPreview(rows);
    } catch (e) { setPreview(null); setError(`Import could not be read: ${(e as Error).message}`); }
    if (fileInput.current) fileInput.current.value = "";
  }
  async function importRows(rows: PropertyInput[]) {
    if (dirty && !window.confirm("Importing refreshes the queue. Discard unsaved changes?")) return;
    setBusy(true); setError("");
    try {
      const data = await request("/api/admin/inspection", { method: "POST", body: JSON.stringify({ rows }) });
      setPreview(null); setDirty(false); setSelectedId(""); await reload();
      setMessage(`${data.imported.rows} rows imported as ${data.imported.properties} properties; ${data.imported.duplicates} duplicates grouped. Existing reviews are preserved.`);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    if (!selected) return; setBusy(true); setError("");
    try {
      const data = await request(`/api/admin/inspection/${selected.id}`, { method: "PATCH", body: JSON.stringify({ revision: selected.revision, review }) });
      setProperties((rows) => rows.map((p) => p.id === data.property.id ? data.property : p)); setReview(data.property.review); setDirty(false); setMessage("Inspection saved. Export joins back to the assessment by Lead ID.");
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function resolve() {
    if (!selected) return; setBusy(true); setError("");
    try {
      const data = await request(`/api/admin/inspection/${selected.id}/parcel`, { method: "POST", body: "{}" });
      setProperties((rows) => rows.map((p) => p.id === data.property.id ? data.property : p)); setMessage(data.note);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  function next() {
    const i = filtered.findIndex((p) => p.id === selectedId); const following = filtered[i + 1]; if (following) choose(following.id);
  }

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-widest text-accent">Property intelligence / inspection workspace</p><h1 className="mt-1 text-3xl font-extrabold tracking-tight">Driving for dollars</h1><p className="mt-2 max-w-2xl text-sm text-ink-soft">Inspect the frontage and lot, record what you can verify, and work through your research queue.</p></div>
      <div className="flex flex-wrap gap-2"><input ref={fileInput} type="file" accept=".csv,.json" className="hidden" aria-label="Import lead list" onChange={(e) => void readFile(e.target.files?.[0])} /><button type="button" className={button} disabled={!databaseConfigured || busy} onClick={() => fileInput.current?.click()}>Import list</button><a className={button} href="/api/admin/inspection/export">Export reviews</a></div>
    </header>
    {!databaseConfigured && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">The existing lead database is not connected. Configure DATABASE_URL and ADMIN_PASSWORD in this project's environment to save inspection imports and reviews.</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Properties", properties.length], ["Located", stats.located], ["Reviews saved", stats.reviewed], ["Complete distress grades", stats.complete]].map(([label, count]) => <div key={label} className="rounded-xl border border-line bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{label}</p><p className="mt-1 text-2xl font-extrabold">{Number(count).toLocaleString()}</p></div>)}</div>
    {initialProperty && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white p-4"><p className="text-sm">Add this report to the inspection queue: <strong>{initialProperty.address}, {initialProperty.city}</strong></p><button type="button" className={button} disabled={busy} onClick={() => void importRows([initialProperty])}>Add property</button></div>}
    {preview && <div className="rounded-xl border border-accent/30 bg-amber-50 p-4"><h2 className="font-bold">Import preview</h2><p className="mt-1 text-sm">{preview.length.toLocaleString()} rows · {previewUnique.toLocaleString()} addresses · {(preview.length - previewUnique).toLocaleString()} duplicates · {preview.filter((p) => p.lat !== null).length.toLocaleString()} coordinate rows</p><p className="mt-1 text-xs text-ink-soft">Only addresses, parcel facts and assessment references are imported. Names and phone numbers in CSVs are ignored. Imported notices and deed ages remain screening evidence.</p><p className="mt-2 text-sm">First property: {preview[0].address}, {preview[0].city}</p><div className="mt-3 flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => void importRows(preview)}>{busy ? "Importing…" : "Import properties"}</button><button type="button" className={button} disabled={busy} onClick={() => setPreview(null)}>Cancel</button></div></div>}
    {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}<button type="button" className="ml-3 underline" disabled={busy} onClick={() => { if (!dirty || window.confirm("Reload and discard unsaved changes?")) { setDirty(false); setSelectedId(""); void reload(); } }}>Reload queue</button></div>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <section className="grid gap-3 rounded-xl border border-line bg-white p-4 md:grid-cols-4" aria-label="Inspection queue filters">
      <label className="text-xs font-semibold text-ink-soft">Find property<input className={field} placeholder="Address, town or Lead ID" value={query} onChange={(e) => { setQuery(e.target.value); setLimit(50); }} /></label>
      <label className="text-xs font-semibold text-ink-soft">Queue<select className={field} value={filter} onChange={(e) => { setFilter(e.target.value as Filter); setLimit(50); }}>{[["all", "All properties"], ["unreviewed", "Not reviewed"], ["unresolved", "Location / parcel unresolved"], ["sheriff", "Sheriff notice"], ["tenure", "5+ year deed proxy"], ["flood", "FEMA SFHA at centroid"]].map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold text-ink-soft">Imported list<select className={field} value={batch} onChange={(e) => setBatch(e.target.value)}><option value="all">All lists</option>{batches.map((b) => <option key={b}>{b}</option>)}</select></label>
      <label className="text-xs font-semibold text-ink-soft">Order<select className={field} value={order} onChange={(e) => setOrder(e.target.value)}><option value="research">Research priority</option><option value="distress">Completed distress score</option><option value="priority">Completed lead priority</option></select></label>
    </section>
    <InspectionMap properties={filtered} selected={selected} rings={rings} onSelect={choose} googleScoringAllowed={googleScoringAllowed} />
    {parcelNote && <p className="text-xs text-ink-soft">{parcelNote}</p>}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.5fr)]">
      <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-label="Property research queue">
        <div className="border-b border-line px-4 py-3"><h2 className="font-bold">Research queue <span className="font-normal text-ink-soft">({filtered.length.toLocaleString()})</span></h2><p className="mt-1 text-xs text-ink-soft">Notices first, then prospecting signals. U means incomplete evidence.</p></div>
        {loading ? <p role="status" className="p-5 text-sm">Loading properties…</p> : !filtered.length ? <div className="p-5 text-sm text-ink-soft"><p>{properties.length ? "No properties match these filters." : "Import your NJ lead CSV or the prepared assessment JSON to start."}</p><p className="mt-2">Plain CSVs need Address and City. Assessment JSON includes parcel coordinates and Lead IDs for export.</p></div> : <ul className="max-h-[650px] overflow-y-auto">{filtered.slice(0, limit).map((p) => {
          const s = inspectionScore(p, p.review, googleScoringAllowed);
          return <li key={p.id} className="border-b border-line last:border-0"><button type="button" aria-pressed={p.id === selectedId} onClick={() => choose(p.id)} className={`w-full px-4 py-3 text-left hover:bg-cream ${p.id === selectedId ? "border-l-4 border-accent bg-cream" : "border-l-4 border-transparent"}`}><div className="flex items-start justify-between gap-2"><span className="font-semibold">{p.address}</span><span className="rounded bg-cream px-2 py-0.5 text-xs font-bold">{s.grade}{s.score !== null ? ` · ${s.score}` : ""}</span></div><p className="mt-1 text-xs text-ink-soft">{p.city} · {p.sourceIds.join(", ") || p.id.slice(-6)}</p><p className="mt-1 text-xs text-ink-soft">{p.sheriffDate ? `Sheriff notice ${p.sheriffDate} · ` : ""}{p.locationStatus !== "matched" ? "Location candidate / unresolved · " : ""}Prospecting {s.proxy}/30{p.reviewedAt ? " · review saved" : ""}</p></button></li>;
        })}</ul>}
        {filtered.length > limit && <button type="button" className="w-full p-3 text-sm font-semibold text-accent" onClick={() => setLimit((n) => n + 50)}>Show 50 more</button>}
      </section>
      <section className="rounded-2xl border border-line bg-white p-5" aria-label="Inspection review form">
        {!selected ? <div className="py-10 text-center"><h2 className="text-xl font-bold">Select a property to inspect</h2><p className="mt-2 text-sm text-ink-soft">Open it from a map point or the research queue.</p></div> : <>
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{selected.address}</h2><p className="text-sm text-ink-soft">{selected.city}{selected.county ? ` · ${selected.county}` : ""}</p></div><span className="rounded-xl bg-cream px-3 py-2 text-sm font-bold">Grade {score?.grade} · {score?.score ?? "incomplete"}</span></div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-accent">{safeLink(selected.recordUrl) && <a className="underline" href={safeLink(selected.recordUrl)!} target="_blank" rel="noopener noreferrer">Parcel source</a>}<a className="underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.address}, ${selected.city}, NJ`)}`} target="_blank" rel="noopener noreferrer">Open Google Maps</a>{selected.lat !== null && <a className="underline" href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${selected.lat},${selected.lng}`} target="_blank" rel="noopener noreferrer">Open Street View</a>}</div>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-cream p-3 text-xs"><p>Block / lot: <strong>{selected.block ?? "unknown"} / {selected.lot ?? "unknown"}</strong></p><p>Deed age proxy: <strong>{selected.tenureYears === null ? "unknown" : `${selected.tenureYears.toFixed(1)} years`}</strong></p><p>Prospecting: <strong>{score?.proxy}/30</strong></p><p>FEMA centroid: <strong>{selected.floodSfha || "unknown"}</strong></p>{selected.tenureConflict && <p className="col-span-2 text-amber-900">Newer reported sale: older ownership points suppressed pending deed confirmation.</p>}{selected.propertyClass === "1" && <p className="col-span-2 text-amber-900">Vacant land classification: confirm improvements and suitability of the house-condition rubric.</p>}</div>
          {selected.notes && <p className="mt-3 whitespace-pre-wrap text-xs text-ink-soft">{selected.notes}</p>}
          {selected.locationStatus !== "matched" && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><p>Location / parcel is unresolved or a candidate. Verify the property before scoring.</p>{selected.lat === null && <button type="button" className={`${button} mt-2`} disabled={busy} onClick={() => void resolve()}>Locate this address</button>}</div>}
          <form className="mt-5 space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="flex items-center gap-3 text-sm font-semibold"><input type="checkbox" checked={review.identityConfirmed} onChange={(e) => update("identityConfirmed", e.target.checked)} />I verified the correct property / unit</label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-ink-soft">Frontage review<select className={field} value={review.streetStatus} onChange={(e) => update("streetStatus", e.target.value as InspectionReview["streetStatus"])}>{["pending", "complete", "obscured", "unavailable"].map((v) => <option key={v}>{v}</option>)}</select></label><label className="text-xs font-semibold text-ink-soft">Lot / roof review<select className={field} value={review.lotStatus} onChange={(e) => update("lotStatus", e.target.value as InspectionReview["lotStatus"])}>{["pending", "complete", "obscured", "unavailable"].map((v) => <option key={v}>{v}</option>)}</select></label></div>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-ink-soft">Scoring evidence<select className={field} value={review.evidenceSource} onChange={(e) => update("evidenceSource", e.target.value as InspectionReview["evidenceSource"])}><option value="google">Google imagery{googleScoringAllowed ? "" : " · reference only"}</option><option value="field">Field inspection</option><option value="owner_photos">Owner-provided photos</option><option value="licensed_imagery">Licensed imagery</option></select></label><label className="text-xs font-semibold text-ink-soft">Imagery / inspection date<input className={field} value={review.imageryDate} placeholder="YYYY-MM or date unavailable" onChange={(e) => update("imageryDate", e.target.value)} /></label></div>
            {!googleScoringAllowed && review.evidenceSource === "google" && <p className="rounded-lg bg-cream p-3 text-xs text-ink-soft">Use the live viewer to locate the property. Saved Google-derived condition scores require permitted imagery rights; record scores from field inspection, owner photos or licensed imagery instead.</p>}
            <div className="grid gap-3 sm:grid-cols-2">{[["roof", "Roof damage · 15 points"], ["landscaping", "Overgrown landscaping · 8"], ["windows", "Boarded / broken windows · 12"], ["exterior", "Exterior deterioration · 15"], ["vacancy", "Vacant appearance · 10"]].map(([key, label]) => <label key={key} className="text-xs font-semibold text-ink-soft">{label}<select className={field} disabled={review.evidenceSource === "google" && !googleScoringAllowed} value={review[key as "roof"] ?? ""} onChange={(e) => update(key as "roof", e.target.value === "" ? null : Number(e.target.value))}><option value="">Unknown / not visible</option><option value="0">0 — inspected, no sign</option><option value="1">1 — minor</option><option value="2">2 — moderate</option><option value="3">3 — severe</option></select></label>)}</div>
            <label className="block text-xs font-semibold text-ink-soft">Evidence reference<input className={field} value={review.evidenceReference} placeholder="Photo URL, field-visit reference or licensed imagery source" onChange={(e) => update("evidenceReference", e.target.value)} /></label>
            <fieldset className="rounded-xl border border-line p-3"><legend className="px-1 text-sm font-bold">Current public-record review · 40 points</legend><p className="mb-3 text-xs text-ink-soft">Historic notices do not establish present debt. Zero requires a completed negative check.</p><div className="grid gap-3 sm:grid-cols-3">{[["foreclosure", "Foreclosure", 20], ["taxLien", "Unpaid tax / lien", 10], ["code", "Unresolved code", 10]].map(([key, label, points]) => <label key={key} className="text-xs font-semibold text-ink-soft">{label}<select className={field} value={review[key as "foreclosure"] ?? ""} onChange={(e) => update(key as "foreclosure", e.target.value === "" ? null : Number(e.target.value) as 0 | 20)}><option value="">Unknown</option><option value="0">Verified negative · 0</option><option value={points}>Verified positive · {points}</option></select></label>)}</div><label className="mt-3 block text-xs font-semibold text-ink-soft">Current records / balance references<input className={field} value={review.recordsReference} onChange={(e) => update("recordsReference", e.target.value)} placeholder="Court, redemption, municipal and code checks" /></label><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={review.recordsComplete} onChange={(e) => update("recordsComplete", e.target.checked)} />Current public-record review completed</label></fieldset>
            <label className="block text-xs font-semibold text-ink-soft">Specific observations<textarea className={`${field} min-h-24`} value={review.notes} onChange={(e) => update("notes", e.target.value)} placeholder="Describe only visible or verified facts. Appearance does not prove legal vacancy." /></label>
            <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-ink-soft">Reviewer<input className={field} required value={review.reviewer} onChange={(e) => update("reviewer", e.target.value)} /></label><label className="text-xs font-semibold text-ink-soft">Next diligence action<input className={field} value={review.followUp} onChange={(e) => update("followUp", e.target.value)} /></label></div>
            <div className="rounded-xl bg-cream p-3 text-sm"><p>Physical: <strong>{score?.physical ?? "incomplete"}/60</strong> · Current records: <strong>{score?.records ?? "incomplete"}/40</strong></p><p className="mt-1 text-xs text-ink-soft">Final grade requires identity, both physical reviews, all inputs and evidence references. Ownership/mailing signals are a separate proxy.</p></div>
            <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={busy || !dirty} className="rounded-lg bg-accent px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{busy ? "Saving…" : "Save inspection"}</button><button type="button" className={button} disabled={busy} onClick={next}>Next property</button><span className="text-xs text-ink-soft">{dirty ? "Unsaved changes" : selected.reviewedAt ? `Saved ${new Date(selected.reviewedAt).toLocaleString()}` : "Not reviewed"}</span></div>
          </form>
        </>}
      </section>
    </div>
  </div>;
}
