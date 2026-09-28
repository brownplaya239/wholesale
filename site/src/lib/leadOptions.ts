/** Answer options shared by the thank-you form (client) and /api/lead (server). */

export const TIMELINES = ["ASAP", "1–3 months", "3+ months", "Just curious"] as const;

export const PRIORITIES = [
  "Speed & certainty",
  "Highest net proceeds",
  "No repairs or cleanup",
  "Not sure — compare options",
] as const;

export const CONDITIONS = [
  "Move-in ready",
  "Needs minor updates",
  "Needs major repairs",
  "Needs a full renovation",
] as const;

export const OCCUPANCY = ["I live there", "Tenant-occupied", "Vacant", "Family member lives there"] as const;

export function oneOf<T extends readonly string[]>(options: T, v: unknown): T[number] | null {
  return typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T[number]) : null;
}
