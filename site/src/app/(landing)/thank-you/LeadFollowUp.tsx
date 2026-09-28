"use client";

import { useEffect, useMemo, useState } from "react";
import { site } from "@/config/site";
import { trackEvent } from "@/lib/analytics";
import { addressProblem, recallLead, rememberLead, type LeadExtras, type RememberedLead } from "@/lib/lead";
import { BATHROOMS, BEDROOMS, CONDITIONS, OCCUPANCY, PRIORITIES, TIMELINES } from "@/lib/leadOptions";

/**
 * Optional prep questions, asked only AFTER the lead is captured. Prefilled
 * from what the seller already gave; every save updates the same lead ID.
 * Nothing here is required.
 */

const MAX_PHOTOS = 8;

async function toJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.85)
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function Chips({
  label,
  options,
  value,
  onChange,
  compact,
}: {
  label: string;
  options: readonly string[];
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  /** Short answers (numbers): one row. */
  compact?: boolean;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-semibold text-ink">{label}</legend>
      <div className={`grid gap-2 ${compact ? "grid-cols-5" : "grid-cols-2"}`}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(value === o ? undefined : o)}
            className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
              value === o ? "border-accent bg-accent/10 text-accent" : "border-line bg-white text-ink-soft hover:border-ink-soft"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function LeadFollowUp() {
  const [lead, setLead] = useState<RememberedLead | null>(null);
  const [draft, setDraft] = useState<LeadExtras>({});
  const [saved, setSaved] = useState<LeadExtras>({});
  const [editAddress, setEditAddress] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [photosOn, setPhotosOn] = useState(false);
  const [photoCount, setPhotoCount] = useState(0);
  const [photoMsg, setPhotoMsg] = useState("");

  useEffect(() => {
    const l = recallLead();
    setLead(l);
    setDraft(l?.extras ?? {});
    setSaved(l?.extras ?? {});
    setPhotoCount(l?.photos ?? 0);
    if (l) {
      fetch("/api/lead/config")
        .then((r) => r.json())
        .then((c: { photos?: boolean }) => setPhotosOn(Boolean(c.photos)))
        .catch(() => {});
    }
  }, []);

  const dirty = useMemo(
    () => (Object.keys({ ...draft, ...saved }) as (keyof LeadExtras)[]).some((k) => (draft[k] ?? "") !== (saved[k] ?? "")),
    [draft, saved]
  );

  if (!lead) return null;

  const set = (k: keyof LeadExtras) => (v: string | undefined) => {
    setState("idle");
    setDraft((d) => ({ ...d, [k]: v }));
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || !dirty) return;
    const edited = draft.addressEdit?.trim();
    if (edited && edited !== lead.address && addressProblem(edited)) {
      setError("Please enter the full street address, including the town and ZIP code.");
      return;
    }
    setError("");
    setState("saving");
    const changed: LeadExtras = {};
    for (const k of Object.keys(draft) as (keyof LeadExtras)[]) {
      if ((draft[k] ?? "") !== (saved[k] ?? "")) changed[k] = draft[k] ?? "";
    }
    if (changed.addressEdit === lead.address) delete changed.addressEdit;
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "details", leadId: lead.leadId, name: lead.name, address: lead.address, pageUrl: window.location.href, ...changed }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || json.ok === false) {
        if (json.error?.startsWith("address_")) {
          setError("That address doesn't look complete — include the street number, town and ZIP.");
          setState("idle");
          return;
        }
        throw new Error(json.error ?? String(res.status));
      }
      const next = { ...lead, extras: { ...draft } };
      rememberLead(next);
      setLead(next);
      setSaved({ ...draft });
      setEditAddress(false);
      setState("saved");
      trackEvent("lead_details_added", { fields: Object.keys(changed).join(",") });
    } catch {
      setState("error");
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!lead || !files?.length) return;
    let count = photoCount;
    for (const file of Array.from(files)) {
      if (count >= MAX_PHOTOS) {
        setPhotoMsg(`Up to ${MAX_PHOTOS} photos — thanks!`);
        break;
      }
      setPhotoMsg(`Uploading ${file.name}…`);
      try {
        const blob = await toJpeg(file);
        const form = new FormData();
        form.append("leadId", lead.leadId);
        form.append("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
        const res = await fetch("/api/lead/photo", { method: "POST", body: form });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; count?: number };
        if (!res.ok || !json.ok) throw new Error();
        count = json.count ?? count + 1;
        setPhotoCount(count);
        rememberLead({ ...lead, photos: count });
        setPhotoMsg(`${count} photo${count === 1 ? "" : "s"} added.`);
      } catch {
        setPhotoMsg(`Couldn't upload ${file.name} — try a different photo, or text it to ${site.phone.display}.`);
      }
    }
  }

  const address = draft.addressEdit ?? lead.address;

  return (
    <form id="details" onSubmit={save} className="mt-8 scroll-mt-4 rounded-2xl border border-line bg-panel p-5 text-left shadow-sm sm:p-6">
      <p className="text-lg font-bold">Optional: help {site.principal.firstName} come prepared</p>
      <p className="mt-1 text-sm text-ink-soft">
        Answer any of these — or none. Your request is already in; this just makes the first call shorter and your numbers more accurate.
      </p>

      <div className="mt-5 space-y-5">
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink">Property address</p>
          {editAddress ? (
            <input
              type="text"
              value={address}
              onChange={(e) => set("addressEdit")(e.target.value)}
              autoComplete="street-address"
              aria-label="Property address"
              className="w-full rounded-lg border border-line bg-white px-4 py-3 text-base focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          ) : (
            <p className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-white px-4 py-3 text-sm">
              <span>{address.replace(/,?\s*USA$/i, "")}</span>
              <button type="button" onClick={() => setEditAddress(true)} className="text-sm font-semibold text-accent underline">
                Edit
              </button>
            </p>
          )}
          <label className="mt-2 block text-sm text-ink-soft">
            Condo or apartment? Unit number
            <input
              type="text"
              value={draft.unit ?? ""}
              onChange={(e) => set("unit")(e.target.value.slice(0, 12))}
              placeholder="e.g. 3B"
              className="mt-1 w-full max-w-[10rem] rounded-lg border border-line bg-white px-3 py-2.5 text-base focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <Chips label="When do you need to sell?" options={TIMELINES} value={draft.timeline} onChange={set("timeline")} />
        <Chips label="What matters most to you?" options={PRIORITIES} value={draft.priority} onChange={set("priority")} />
        <Chips label="Condition of the property" options={CONDITIONS} value={draft.condition} onChange={set("condition")} />
        <Chips label="Who lives there now?" options={OCCUPANCY} value={draft.occupancy} onChange={set("occupancy")} />
        <Chips label="Bedrooms" options={BEDROOMS} value={draft.beds} onChange={set("beds")} compact />
        <Chips label="Bathrooms" options={BATHROOMS} value={draft.baths} onChange={set("baths")} compact />

        <label className="block text-sm font-semibold text-ink">
          Email for your written numbers
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={draft.email ?? ""}
            onChange={(e) => set("email")(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 w-full rounded-lg border border-line bg-white px-4 py-3 text-base font-normal focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>

        <label className="block text-sm font-semibold text-ink">
          Anything else we should know?
          <textarea
            rows={3}
            maxLength={1000}
            value={draft.notes ?? ""}
            onChange={(e) => set("notes")(e.target.value)}
            placeholder="Recent updates, repairs needed, liens, tenants, probate…"
            className="mt-1.5 w-full rounded-lg border border-line bg-white px-4 py-3 text-base font-normal focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>

        {photosOn && (
          <div>
            <p className="text-sm font-semibold text-ink">Photos (optional)</p>
            <p className="text-xs text-ink-soft">Outside, kitchen, baths, anything that needs work. Seen only by {site.principal.firstName}.</p>
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-semibold hover:border-ink-soft">
              <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
              Add photos
            </label>
            {photoMsg && <p className="mt-1.5 text-sm text-ink-soft">{photoMsg}</p>}
          </div>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      {state === "error" && (
        <p className="mt-4 text-sm text-red-700">
          Couldn&apos;t save that — your request is still in. You can text the details to {site.phone.display}.
        </p>
      )}
      <button
        type="submit"
        disabled={!dirty || state === "saving"}
        className="mt-5 w-full rounded-lg bg-ink px-6 py-3.5 text-base font-bold text-white transition-opacity disabled:opacity-40"
      >
        {state === "saving" ? "Saving…" : `Send to ${site.principal.firstName}`}
      </button>
      {state === "saved" && !dirty && (
        <p className="mt-2 text-center text-sm font-semibold text-trust">Saved — {site.principal.firstName} will have this before your call.</p>
      )}
    </form>
  );
}
