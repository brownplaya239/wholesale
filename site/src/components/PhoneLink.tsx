"use client";

import { site } from "@/config/site";
import { trackEvent } from "@/lib/analytics";

/**
 * Every visible phone number goes through this component so (a) CallRail DNI
 * can swap it (class "dni-phone"), and (b) taps fire the call_click event.
 */
export default function PhoneLink({
  className = "",
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <a
      href={`tel:${site.phone.e164}`}
      className={className}
      onClick={() => trackEvent("call_click", { phone: site.phone.display })}
    >
      {children ?? <span className="dni-phone">{site.phone.display}</span>}
    </a>
  );
}
