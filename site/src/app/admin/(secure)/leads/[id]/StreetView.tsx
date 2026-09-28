"use client";

import { useEffect, useState } from "react";

/**
 * Street View via Google's official Street View Static API (with its
 * metadata check first, which is free). Falls back to a Google Maps link when
 * there's no imagery or the API isn't enabled for this key.
 */
export default function StreetView({ lat, lng }: { lat: number; lng: number }) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  const [state, setState] = useState<{ status: string; date?: string } | null>(null);
  const loc = `${lat},${lng}`;
  const link = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${loc}`;

  useEffect(() => {
    if (!key) {
      setState({ status: "NO_KEY" });
      return;
    }
    fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${loc}&source=outdoor&key=${key}`)
      .then((r) => r.json())
      .then((j: { status: string; date?: string }) => setState(j))
      .catch(() => setState({ status: "ERROR" }));
  }, [key, loc]);

  if (!state) return <div className="flex aspect-video items-center justify-center rounded-xl bg-cream text-sm text-ink-soft">Loading Street View…</div>;
  if (state.status !== "OK") {
    const why =
      state.status === "ZERO_RESULTS" || state.status === "NOT_FOUND"
        ? "No Street View imagery at this location."
        : state.status === "REQUEST_DENIED"
          ? "Street View Static API isn't enabled for this Google key."
          : "Street View unavailable.";
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl bg-cream p-4 text-center text-sm text-ink-soft">
        <p>{why}</p>
        <a href={link} target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline">
          Open in Google Maps
        </a>
      </div>
    );
  }
  return (
    <figure>
      <a href={link} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${loc}&source=outdoor&key=${key}`}
          alt="Street View of the property"
          className="aspect-video w-full rounded-xl object-cover"
        />
      </a>
      <figcaption className="mt-1 text-xs text-ink-soft">
        Google Street View{state.date ? ` · imagery ${state.date}` : ""} · © Google
      </figcaption>
    </figure>
  );
}
