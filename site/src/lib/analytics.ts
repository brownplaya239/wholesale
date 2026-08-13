"use client";

/**
 * Thin event layer (spec §6). Pushes to GA4 via gtag when present and always
 * to dataLayer, so events keep flowing if tag management changes later.
 *
 * Canonical events:
 *  - lead_step1_complete  (micro conversion — address captured)
 *  - lead_submit          (primary conversion)
 *  - call_click           (tap on any tel: link)
 *  - thank_you_engaged    (10s+ on /thank-you)
 */

type EventParams = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

export function trackEvent(name: string, params: EventParams = {}): void {
  if (typeof window === "undefined") return;
  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: name, ...params });
    if (typeof window.gtag === "function") {
      window.gtag("event", name, params);
    }
  } catch {
    // Analytics must never break the form.
  }
}
