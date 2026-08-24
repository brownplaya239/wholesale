"use client";

import { useEffect, useRef } from "react";

/**
 * Property-address input with Google Places autocomplete (spec §3).
 * Degrades to a plain text input when NEXT_PUBLIC_GOOGLE_PLACES_KEY is unset
 * or the script fails — the form must never depend on Google being up.
 */

declare global {
  interface Window {
    google?: any;
    __placesReady?: () => void;
  }
}

let scriptRequested = false;

function loadPlaces(onReady: () => void) {
  const key = process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY;
  if (!key) return;
  // If Google's auth fails (billing/API/referrer misconfig) it appends a
  // blocking "This page can't load Google Maps correctly" dialog over the
  // page. Strip it — the form must never be covered by a Google error.
  (window as any).gm_authFailure = () => {
    document.querySelectorAll("body > div").forEach((el) => {
      if (
        el.textContent?.includes("can't load Google Maps correctly") ||
        el.textContent?.includes("Do you own this website?")
      ) {
        el.remove();
      }
    });
  };
  if (window.google?.maps?.places) {
    onReady();
    return;
  }
  const prev = window.__placesReady;
  window.__placesReady = () => {
    prev?.();
    onReady();
  };
  if (scriptRequested) return;
  scriptRequested = true;
  const s = document.createElement("script");
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
    key
  )}&libraries=places&callback=__placesReady`;
  s.async = true;
  document.head.appendChild(s);
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  inputId,
}: {
  value: string;
  onChange: (address: string) => void;
  /** Fired when the user picks a suggestion (address + place_id verified). */
  onSelect: (address: string, placeId: string) => void;
  inputId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const attached = useRef(false);

  useEffect(() => {
    loadPlaces(() => {
      // Any Google-side failure (API not enabled, key restriction, quota)
      // must degrade to the plain input — never touch the form itself.
      try {
        if (attached.current || !inputRef.current || !window.google?.maps?.places?.Autocomplete)
          return;
        attached.current = true;
        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          types: ["address"],
          componentRestrictions: { country: "us" },
          fields: ["formatted_address", "place_id"],
        });
        ac.addListener("place_changed", () => {
          const place = ac.getPlace();
          if (place?.formatted_address) {
            onSelect(place.formatted_address, place.place_id ?? "");
          }
        });
      } catch {
        // Autocomplete unavailable — plain input keeps working.
      }
    });
    // onSelect is stable in our usage; attach once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={inputRef}
      id={inputId}
      type="text"
      inputMode="text"
      autoComplete="street-address"
      placeholder="Enter your property address"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-line bg-white px-4 py-3.5 text-base text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      required
      aria-label="Property address"
    />
  );
}
