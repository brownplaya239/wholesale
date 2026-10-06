"use client";

import { useEffect, useRef, useState } from "react";
import { inspectionScore, type InspectionProperty } from "@/lib/inspection/model";

declare global { interface Window { __inspectionMapsReady?: () => void; gm_authFailure?: () => void; } }
let loading: Promise<void> | null = null;
function loadMaps(): Promise<void> {
  if (window.google?.maps?.Map) return Promise.resolve();
  if (loading) return loading;
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  if (!key) return Promise.reject(new Error("Map access is not configured. You can still review the list and open Google Maps links."));
  loading = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Google Maps took too long to load. Check your connection and retry.")), 15000);
    window.__inspectionMapsReady = () => { clearTimeout(timer); resolve(); };
    window.gm_authFailure = () => {
      clearTimeout(timer);
      window.dispatchEvent(new Event("hsnj-maps-auth-failure"));
      reject(new Error("Google Maps denied access. Check billing, Maps JavaScript API and this site's key restrictions."));
    };
    const script = document.createElement("script"); script.id = "hsnj-inspection-maps";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__inspectionMapsReady&loading=async&v=weekly`;
    script.async = true; script.onerror = () => { clearTimeout(timer); reject(new Error("Google Maps could not load.")); };
    document.head.appendChild(script);
  }).catch((error) => { loading = null; document.getElementById("hsnj-inspection-maps")?.remove(); throw error; });
  return loading;
}

function heading(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const rad = Math.PI / 180; const delta = (toLng - fromLng) * rad;
  return (Math.atan2(Math.sin(delta) * Math.cos(toLat * rad), Math.cos(fromLat * rad) * Math.sin(toLat * rad) - Math.sin(fromLat * rad) * Math.cos(toLat * rad) * Math.cos(delta)) / rad + 360) % 360;
}
export default function InspectionMap({ properties, selected, rings, onSelect, googleScoringAllowed }: {
  properties: InspectionProperty[]; selected: InspectionProperty | null; rings: [number, number][][] | null;
  onSelect: (id: string) => void; googleScoringAllowed: boolean;
}) {
  const mapDiv = useRef<HTMLDivElement>(null); const panoDiv = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null); const panorama = useRef<any>(null); const outlines = useRef<any[]>([]);
  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const [ready, setReady] = useState(false); const [error, setError] = useState(""); const [attempt, setAttempt] = useState(0);
  const [authDenied, setAuthDenied] = useState(false);
  const [mode, setMode] = useState("hybrid"); const [street, setStreet] = useState("Select a located property to inspect its frontage.");
  useEffect(() => {
    let alive = true;
    const authFailure = () => {
      setAuthDenied(true);
      setError("Google Maps denied access. Check billing, Maps JavaScript API and this site's key restrictions.");
      setReady(false);
      loading = null;
      document.getElementById("hsnj-inspection-maps")?.remove();
    };
    window.addEventListener("hsnj-maps-auth-failure", authFailure);
    loadMaps().then(() => {
      if (!alive || !mapDiv.current || !panoDiv.current) return;
      const g = window.google.maps;
      map.current = new g.Map(mapDiv.current, { center: { lat: 40.1, lng: -74.6 }, zoom: 8, mapTypeId: "hybrid", streetViewControl: false, fullscreenControl: true, mapTypeControl: false });
      panorama.current = new g.StreetViewPanorama(panoDiv.current, { visible: false, addressControl: true, fullscreenControl: true, motionTracking: false });
      map.current.data.addListener("click", (e: any) => onSelectRef.current(String(e.feature.getId())));
      setReady(true); setError("");
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; window.removeEventListener("hsnj-maps-auth-failure", authFailure); if (window.google?.maps?.event && map.current) window.google.maps.event.clearInstanceListeners(map.current.data); outlines.current.forEach((p) => p.setMap(null)); map.current = null; panorama.current?.setVisible(false); setReady(false); };
  }, [attempt]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const g = window.google.maps; const data = map.current.data;
    data.forEach((f: any) => data.remove(f));
    data.addGeoJson({ type: "FeatureCollection", features: properties.filter((p) => p.lat !== null && p.lng !== null).map((p) => ({
      type: "Feature", id: p.id, geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: { label: `${p.address}, ${p.city}`, grade: inspectionScore(p, p.review, googleScoringAllowed).grade, selected: p.id === selected?.id, candidate: p.locationStatus !== "matched", sheriff: Boolean(p.sheriffDate) },
    })) });
    data.setStyle((f: any) => ({ icon: { path: g.SymbolPath.CIRCLE, scale: f.getProperty("selected") ? 10 : 6,
      fillColor: f.getProperty("candidate") ? "#9ca3af" : f.getProperty("sheriff") ? "#b45309" : ({ A: "#b91c1c", B: "#c2410c", C: "#a16207", D: "#15803d", U: "#51616f" } as Record<string, string>)[f.getProperty("grade")],
      fillOpacity: 1, strokeColor: f.getProperty("selected") ? "#ffffff" : "#1c2b39", strokeWeight: f.getProperty("selected") ? 3 : 1 }, title: f.getProperty("label"), zIndex: f.getProperty("selected") ? 10 : 1 }));
  }, [ready, properties, selected?.id, googleScoringAllowed]);
  useEffect(() => { if (ready) map.current?.setMapTypeId(mode); }, [ready, mode]);
  useEffect(() => {
    if (!ready || !map.current) return;
    const g = window.google.maps;
    outlines.current.forEach((p) => p.setMap(null)); outlines.current = [];
    if (!rings?.length || !selected) return;
    const bounds = new g.LatLngBounds();
    for (const ring of rings) {
      const paths = ring.map(([lng, lat]) => ({ lat, lng })); paths.forEach((p) => bounds.extend(p));
      outlines.current.push(new g.Polygon({ map: map.current, paths, strokeColor: "#facc15", strokeWeight: 3, fillOpacity: 0, clickable: false }));
    }
    map.current.fitBounds(bounds, 65);
  }, [ready, rings, selected?.id]);
  useEffect(() => {
    if (!ready || !map.current || !panorama.current) return;
    let alive = true; const p = selected; panorama.current.setVisible(false);
    if (!p || p.lat === null || p.lng === null) { setStreet("Address location unresolved. Confirm it before inspecting imagery."); return; }
    const g = window.google.maps; const point = { lat: p.lat, lng: p.lng }; map.current.setCenter(point); map.current.setZoom(19);
    setStreet("Checking nearby Street View coverage…");
    new g.StreetViewService().getPanorama({ location: point, radius: 50, source: g.StreetViewSource.OUTDOOR }, (data: any, status: string) => {
      if (!alive) return;
      if (status !== "OK" || !data?.location?.latLng) { setStreet("No outdoor panorama available within 50 m. Use a field inspection or another authorized source."); return; }
      const camera = data.location.latLng;
      panorama.current.setPano(data.location.pano);
      panorama.current.setPov({ heading: heading(camera.lat(), camera.lng(), point.lat, point.lng), pitch: 0 });
      panorama.current.setVisible(true);
      setStreet(`Street View imagery: ${data.imageDate || "date unavailable"}. Nearest panorama; verify the house number and frontage.`);
    });
    return () => { alive = false; };
  }, [ready, selected?.id, selected?.lat, selected?.lng]);
  return <section className="overflow-hidden rounded-2xl border border-line bg-white" aria-label="Property map and Street View inspection">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div><h2 className="font-bold">Street & lot inspection</h2><p className="text-xs text-ink-soft">Yellow outline = NJ tax parcel · gray = unreviewed/candidate · amber = sheriff notice</p></div>
      <div className="flex gap-2"><button type="button" aria-pressed={mode === "roadmap"} onClick={() => setMode("roadmap")} className="rounded-lg border border-line px-3 text-sm">Road map</button><button type="button" aria-pressed={mode === "hybrid"} onClick={() => setMode("hybrid")} className="rounded-lg border border-line px-3 text-sm">Satellite / lot</button></div>
    </div>
    {error && <div role="alert" className="bg-amber-50 p-4 text-sm text-amber-900">{error}<button type="button" className="ml-3 underline" onClick={() => { if (authDenied) { window.location.reload(); return; } setError(""); setAttempt((n) => n + 1); }}>Retry map</button></div>}
    {!ready && !error && <p role="status" className="p-4 text-sm text-ink-soft">Loading map…</p>}
    <div className={error ? "hidden" : "grid md:grid-cols-2"}><div ref={mapDiv} className="h-[340px] bg-cream md:h-[430px]" aria-label="Property locations and parcel outline" /><div ref={panoDiv} className="h-[340px] border-t border-line bg-cream md:h-[430px] md:border-l md:border-t-0" aria-label="Street View panorama" /></div>
    <p role="status" className="border-t border-line px-4 py-3 text-xs text-ink-soft">{error ? "Live imagery is unavailable. Use the selected property's Google Maps links or retry after updating access." : street} Satellite acquisition date is unavailable in this API; appearance does not establish legal vacancy.</p>
  </section>;
}
