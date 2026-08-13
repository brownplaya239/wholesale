/**
 * Message match (spec §1): the ad's URL params fill the headline.
 *
 * Supported params on / and /lp/{slug}:
 *   ?loc=Toms%20River   → "Sell Your House Fast in Toms River, NJ"
 *   ?sit=probate        → situation framing (must match a situation slug)
 *
 * Params come from ad URLs we author, but they're still user-controllable
 * input — sanitize hard so nobody can inject spam into our own headline.
 */

const LOC_RE = /^[a-zA-Z .'-]{2,40}$/;

export function resolveGeo(loc: string | undefined): string {
  if (!loc) return "New Jersey";
  const cleaned = loc.trim().replace(/\s+/g, " ");
  if (!LOC_RE.test(cleaned)) return "New Jersey";
  // Title-case each word; keep interior capitals like "McGuire" intact.
  return cleaned
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** "Toms River" -> "Toms River, NJ"; "New Jersey" stays bare. */
export function geoWithState(geo: string): string {
  return geo === "New Jersey" ? "New Jersey" : `${geo}, NJ`;
}
