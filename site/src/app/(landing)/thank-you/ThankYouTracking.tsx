"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/analytics";

/**
 * Conversion measurement on /thank-you (spec §6):
 * - Google Ads conversion tag fires once on mount (env-gated).
 * - thank_you_engaged fires after 10s on page.
 */
export default function ThankYouTracking() {
  useEffect(() => {
    const gads = process.env.NEXT_PUBLIC_GADS_CONVERSION;
    if (gads && typeof window.gtag === "function") {
      window.gtag("event", "conversion", { send_to: gads });
    }
    const t = setTimeout(() => trackEvent("thank_you_engaged"), 10_000);
    return () => clearTimeout(t);
  }, []);
  return null;
}
