/**
 * Photo check: Claude looks at the Street View and satellite pictures and
 * reports visible distress — the eyes-on half of the distress assessment.
 * Observable facts only, each tagged with where it was seen and how sure;
 * "unclear" whenever the house isn't plainly in frame. Internal use; needs
 * ANTHROPIC_API_KEY (without it the section reads "not configured").
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { renderImage } from "@/lib/leads/images";
import { nowIso } from "./http";
import { PHOTO_INDICATORS, type PhotoCheck } from "./photoTypes";
import type { Section, SourceRef } from "./types";

const PhotoCheckSchema = z.object({
  street_view: z.object({
    view: z.enum(["clear", "partly_obstructed", "house_not_visible", "not_provided"]),
    house_number: z.enum(["matches", "different", "not_visible", "not_provided"]),
  }),
  satellite: z.object({ view: z.enum(["clear", "unclear", "not_provided"]) }),
  findings: z.array(
    z.object({
      indicator: z.enum(PHOTO_INDICATORS),
      seen_in: z.enum(["street_view", "satellite"]),
      confidence: z.enum(["high", "medium", "low"]),
      detail: z.string(),
    })
  ),
  overall: z.enum(["none", "minor", "moderate", "severe", "unclear"]),
  summary: z.string(),
});

export type { PhotoCheck };

const MODEL = "claude-opus-5";

const SYSTEM = `You help a licensed New Jersey real estate agent triage seller leads before the first call. You get up to two pictures of one property: a Google Street View photo aimed at the address, and a satellite view with the tax parcel outlined in yellow and a red dot on the address point.

Report only what is visible. Judge the house against its neighbors: age, architectural style and ordinary wear are not distress; neglect and damage are. A single untidy moment (trash cans at the curb, a car in the driveway, leaves in fall) is not a finding.

Findings, from this fixed list:
- roof_tarp: a tarp over part of the roof.
- roof_damage: missing or mismatched shingle patches, holes, sagging roofline, heavy moss or staining.
- boarded_or_broken_windows: plywood over windows or doors, broken glass.
- structural_damage: sagging or collapsed porch, deck or roof sections; fire or water damage; leaning walls.
- exterior_disrepair: peeling or failing paint, missing or damaged siding, rotted trim, hanging gutters, broken fence — clearly worse than the neighbors.
- overgrown_yard: tall grass, weeds, vines on the house, shrubs swallowing windows or walks — clearly worse than the neighbors.
- debris_or_junk: piles of trash or belongings, junk or abandoned vehicles, a dumpster.
- neglected_pool: green, empty or debris-filled pool.
- vacancy_cues: notices on the door, papers or mail piled up, no window coverings, a lockbox with no listing sign, combined with an unkempt lot.
- renovation_in_progress: scaffolding, a construction dumpster, materials, new windows with stickers. Not distress by itself; report it so the agent knows.

Confidence: high = unmistakable; medium = likely, but small, partly hidden or low resolution; low = possible, can't confirm. Say where you saw it and describe it in a short phrase (at most 15 words), e.g. "blue tarp on the rear roof slope".

Overall: none = normal upkeep; minor = cosmetic only (faded paint, some untidiness); moderate = clear deferred maintenance that will need repair money; severe = major damage or signs of abandonment. Use unclear when the house can't be seen well enough in either picture to judge.

Street View: set view to house_not_visible if trees, a truck or the angle hide the house, or if the camera clearly isn't on the right building, and base nothing on it then. house_number: compare any number visible on the house, mailbox or curb with the address's number.

Summary: one plain sentence of at most 20 words, for the top of the agent's email.`;

async function asBase64(kind: "street" | "satellite", lat: number, lng: number, rings: [number, number][][] | null) {
  const img = await renderImage(kind, lat, lng, rings);
  if (!img) return null;
  return { data: Buffer.from(img.body).toString("base64"), mediaType: img.type as "image/jpeg" | "image/png" };
}

export async function photoCheck(input: {
  address: string;
  lat: number;
  lng: number;
  rings: [number, number][][] | null;
  streetView: { status: string; date: string | null } | undefined;
}): Promise<Section<PhotoCheck>> {
  const source: SourceRef = { id: "claude_vision", name: `Claude photo check (${MODEL}) of Street View + satellite`, retrievedAt: nowIso() };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { status: "not_configured", data: null, source: null, note: "Add ANTHROPIC_API_KEY in Vercel to have the photos checked for distress." };
  }
  const [street, satellite] = await Promise.all([
    input.streetView?.status === "ok" ? asBase64("street", input.lat, input.lng, input.rings) : Promise.resolve(null),
    asBase64("satellite", input.lat, input.lng, input.rings),
  ]);
  if (!street && !satellite) return { status: "missing", data: null, source, note: "No pictures available to check." };

  const houseNumber = input.address.match(/^\s*(\d+[A-Z]?)/i)?.[1] ?? "unknown";
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `Property: ${input.address} (house number ${houseNumber}).` },
  ];
  if (street) {
    content.push(
      { type: "text", text: `Street View photo${input.streetView?.date ? `, taken ${input.streetView.date}` : ""}:` },
      { type: "image", source: { type: "base64", media_type: street.mediaType, data: street.data } }
    );
  } else {
    content.push({ type: "text", text: "No Street View photo exists for this address (set street_view to not_provided)." });
  }
  if (satellite) {
    content.push(
      { type: "text", text: "Satellite view (parcel outlined in yellow, red dot = address point):" },
      { type: "image", source: { type: "base64", media_type: satellite.mediaType, data: satellite.data } }
    );
  } else {
    content.push({ type: "text", text: "No satellite view (set satellite to not_provided)." });
  }
  content.push({ type: "text", text: "Report what you see." });

  try {
    const client = new Anthropic({ maxRetries: 1, timeout: 55_000 });
    const res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: betaZodOutputFormat(PhotoCheckSchema) },
      // If the primary model declines, the API retries on a fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (res.stop_reason === "refusal") {
      return { status: "error", data: null, source, error: `declined (${res.stop_details?.category ?? "no category"})` };
    }
    const out = res.parsed_output;
    if (!out) return { status: "error", data: null, source, error: `no structured result (stop: ${res.stop_reason})` };
    return { status: "ok", data: { ...out, streetViewDate: input.streetView?.date ?? null, model: res.model }, source };
  } catch (err) {
    const detail = err instanceof Anthropic.APIError ? `API ${err.status ?? ""} ${err.message}` : String(err);
    return { status: "error", data: null, source, error: detail.slice(0, 300) };
  }
}
