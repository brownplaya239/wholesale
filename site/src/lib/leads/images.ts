/**
 * Property pictures for the report email and page: Street View (the front of
 * the house), satellite with the tax parcel outlined, and a road map.
 *
 * Email clients can't log in, so images are served from /api/img/{id}/{kind}
 * behind an HMAC signature and rendered on request. Satellite and road map
 * use Google's Maps Static API when it's enabled for the key, else Esri
 * basemaps with the parcel outline drawn in here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import jpeg from "jpeg-js";
import { site } from "@/config/site";
import { fetchJson } from "@/lib/enrich/http";

export const IMAGE_KINDS = ["street", "satellite", "map"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export type StreetViewMeta = {
  status: "ok" | "none" | "not_configured" | "error";
  date: string | null;
};

const googleKey = () => process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY || "";
const secret = () => process.env.CRON_SECRET || process.env.ADMIN_PASSWORD || "";

function sig(id: string, kind: string, v: string): string {
  return createHmac("sha256", `hsnj-img:${secret()}`).update(`${id}:${kind}:${v}`).digest("base64url").slice(0, 32);
}

/** Signed, cacheable image URL; `v` changes when the report is rebuilt. */
export function imageUrl(id: string, kind: ImageKind, v: string): string | null {
  if (!secret()) return null;
  const ver = String(Date.parse(v) || 0);
  return `${site.url}/api/img/${encodeURIComponent(id)}/${kind}?v=${ver}&s=${sig(id, kind, ver)}`;
}

export function verifyImage(id: string, kind: string, v: string | null, s: string | null): boolean {
  if (!secret() || !v || !s || !(IMAGE_KINDS as readonly string[]).includes(kind)) return false;
  const want = Buffer.from(sig(id, kind, v));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Street View availability + imagery date (the metadata call is free). */
export async function streetViewMeta(lat: number, lng: number): Promise<StreetViewMeta> {
  const key = googleKey();
  if (!key) return { status: "not_configured", date: null };
  try {
    const j = await fetchJson<{ status: string; date?: string }>(
      "google_streetview",
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&source=outdoor&key=${key}`,
      { retries: 1, cacheKey: `streetview_meta:${lat.toFixed(5)},${lng.toFixed(5)}`, cacheTtlSec: 30 * 86_400 }
    );
    if (j.status === "OK") return { status: "ok", date: j.date ?? null };
    return { status: j.status === "ZERO_RESULTS" || j.status === "NOT_FOUND" ? "none" : "error", date: null };
  } catch {
    return { status: "error", date: null };
  }
}

// ---- geometry (Web Mercator meters) ----------------------------------------

const R = 6378137;
const mx = (lng: number) => (R * lng * Math.PI) / 180;
const my = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const lngOf = (x: number) => (x / R) * (180 / Math.PI);
const latOf = (y: number) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);

type Extent = { xmin: number; ymin: number; xmax: number; ymax: number };
const W = 640;
const H = 400;

/** A W×H frame around the parcel (or point), padded, at least `minWidth` m wide. */
function frame(lat: number, lng: number, rings: [number, number][][] | null, pad: number, minWidth: number): Extent {
  const pts = rings?.flat().length ? rings.flat() : [[lng, lat] as [number, number]];
  const xs = pts.map((p) => mx(p[0]));
  const ys = pts.map((p) => my(p[1]));
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  let w = Math.max((Math.max(...xs) - Math.min(...xs)) * pad, minWidth);
  let h = Math.max((Math.max(...ys) - Math.min(...ys)) * pad, minWidth / (W / H));
  if (w / h < W / H) w = h * (W / H);
  else h = w / (W / H);
  return { xmin: cx - w / 2, ymin: cy - h / 2, xmax: cx + w / 2, ymax: cy + h / 2 };
}

// ---- drawing on a decoded JPEG --------------------------------------------

type Raster = { width: number; height: number; data: Uint8Array };

function dot(img: Raster, cx: number, cy: number, r: number, c: [number, number, number]) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    if (y < 0 || y >= img.height) continue;
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || x >= img.width || (x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = (y * img.width + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
    }
  }
}

function line(img: Raster, x0: number, y0: number, x1: number, y1: number, r: number, c: [number, number, number]) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
  for (let i = 0; i <= steps; i++) dot(img, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, r, c);
}

/** Outlines the parcel and marks the address point on an image of extent `e`. */
export function annotate(jpg: Uint8Array, e: Extent, lat: number, lng: number, rings: [number, number][][] | null): Buffer {
  const img = jpeg.decode(jpg, { useTArray: true, formatAsRGBA: true }) as Raster;
  const px = (lngV: number) => ((mx(lngV) - e.xmin) / (e.xmax - e.xmin)) * img.width;
  const py = (latV: number) => ((e.ymax - my(latV)) / (e.ymax - e.ymin)) * img.height;
  for (const ring of rings ?? []) {
    for (let i = 1; i < ring.length; i++) {
      // Dark halo under a bright line reads on both lawns and rooftops.
      line(img, px(ring[i - 1][0]), py(ring[i - 1][1]), px(ring[i][0]), py(ring[i][1]), 2.6, [20, 20, 20]);
    }
    for (let i = 1; i < ring.length; i++) {
      line(img, px(ring[i - 1][0]), py(ring[i - 1][1]), px(ring[i][0]), py(ring[i][1]), 1.4, [255, 212, 0]);
    }
  }
  dot(img, px(lng), py(lat), 6, [255, 255, 255]);
  dot(img, px(lng), py(lat), 4.5, [220, 38, 38]);
  return jpeg.encode({ data: img.data, width: img.width, height: img.height }, 85).data;
}

// ---- sources ----------------------------------------------------------------

async function get(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Referer: `${site.url}/` } });
    if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Largest ring, thinned to keep the Static Maps URL short. */
function pathPoints(rings: [number, number][][]): string {
  const ring = [...rings].sort((a, b) => b.length - a.length)[0] ?? [];
  const step = Math.max(1, Math.ceil(ring.length / 60));
  const pts = ring.filter((_, i) => i % step === 0 || i === ring.length - 1);
  return pts.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join("|");
}

async function googleStatic(kind: "satellite" | "map", lat: number, lng: number, rings: [number, number][][] | null, e: Extent) {
  const key = googleKey();
  if (!key) return null;
  const q = new URLSearchParams({ size: `${W}x${H}`, maptype: kind === "satellite" ? "satellite" : "roadmap", key });
  q.append("markers", `size:small|color:red|${lat},${lng}`);
  if (rings?.length) q.append("path", `color:0xffd400ff|weight:3|fillcolor:0xffd40020|${pathPoints(rings)}`);
  // Explicit center/zoom: Google's auto-fit won't zoom in past neighborhood
  // level. Largest zoom whose view still covers the frame.
  const mPerPx = (e.xmax - e.xmin) / W;
  const zoom = Math.max(12, Math.min(20, Math.floor(Math.log2(156543.03392 / mPerPx))));
  q.set("center", `${latOf((e.ymin + e.ymax) / 2).toFixed(6)},${lngOf((e.xmin + e.xmax) / 2).toFixed(6)}`);
  q.set("zoom", String(zoom));
  return get(`https://maps.googleapis.com/maps/api/staticmap?${q}`);
}

const ESRI = {
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
  map: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export",
};

export async function renderImage(
  kind: ImageKind,
  lat: number,
  lng: number,
  rings: [number, number][][] | null
): Promise<{ body: Uint8Array; type: string; source: string } | null> {
  if (kind === "street") {
    const key = googleKey();
    if (!key) return null;
    const body = await get(`https://maps.googleapis.com/maps/api/streetview?size=${W}x${H}&location=${lat},${lng}&source=outdoor&fov=80&key=${key}`);
    return body ? { body, type: "image/jpeg", source: "Google Street View" } : null;
  }
  // Satellite: the lot and its neighbors (~150 m); road map: ~1 km of streets.
  let e = kind === "satellite" ? frame(lat, lng, rings, 2.4, 150) : frame(lat, lng, rings, 12, 1100);
  const g = await googleStatic(kind, lat, lng, rings, e);
  if (g) return { body: g, type: "image/png", source: "Google" };
  // Esri imagery can't zoom past ~0.35 m/pixel: frame at least ~220 m across.
  if (kind === "satellite") e = frame(lat, lng, rings, 2.4, 220);
  const bbox = `${e.xmin},${e.ymin},${e.xmax},${e.ymax}`;
  const raw = await get(`${ESRI[kind]}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=${W},${H}&format=jpg&f=image`);
  if (!raw) return null;
  return { body: annotate(raw, e, lat, lng, kind === "satellite" ? rings : null), type: "image/jpeg", source: "Esri" };
}
