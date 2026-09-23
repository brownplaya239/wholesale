"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AddressAutocomplete from "@/components/AddressAutocomplete";
import PhoneLink from "@/components/PhoneLink";
import { CONSENT_TEXT, site } from "@/config/site";
import { trackEvent } from "@/lib/analytics";
import { rememberLead, type LeadSubmission } from "@/lib/lead";

/**
 * The two-step form (spec §4).
 *
 * Step 1: address only — low-friction commitment, advances instantly with no
 *         page reload. Nothing is sent to the server: an address with no
 *         contact info isn't a lead. The step-1 analytics event goes to GA4
 *         only, so Google Ads never optimizes toward address-only visitors.
 * Step 2: name, mobile, unticked consent box — nothing else. Timeline,
 *         priority, and email are optional extras on /thank-you, asked only
 *         after the lead is already captured.
 *
 * If every delivery channel fails server-side, we show the direct-call
 * fallback instead of a false "we got it".
 */

function newLeadId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `lead-${Math.random().toString(36).slice(2)}`;
  }
}

export default function LeadForm({ idPrefix = "lead" }: { idPrefix?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [address, setAddress] = useState("");
  const [placeId, setPlaceId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false); // unticked by design
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<"" | "fields" | "consent" | "delivery">("");
  const leadId = useRef(newLeadId());

  const post = useCallback(async (body: LeadSubmission) => {
    const res = await fetch("/api/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`lead post failed: ${res.status}`);
  }, []);

  function handleStep1(e: React.FormEvent) {
    e.preventDefault();
    if (address.trim().length < 4) {
      setError("fields");
      return;
    }
    setError("");
    setStep(2);
    trackEvent("lead_step1_complete", {
      page: window.location.pathname,
      send_to: process.env.NEXT_PUBLIC_GA4_ID,
    });
  }

  async function handleStep2(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2 || phone.replace(/\D/g, "").length < 10) {
      setError("fields");
      return;
    }
    if (!consent) {
      setError("consent");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await post({
        stage: "full",
        leadId: leadId.current,
        address: address.trim(),
        placeId,
        name: name.trim(),
        phone: phone.trim(),
        consentChecked: consent,
        consentText: CONSENT_TEXT,
        pageUrl: window.location.href,
      });
      trackEvent("lead_submit", { page: window.location.pathname });
      rememberLead({
        leadId: leadId.current,
        name: name.trim(),
        address: address.trim(),
      });
      router.push("/thank-you");
    } catch {
      setSubmitting(false);
      setError("delivery");
    }
  }

  const inputCls =
    "w-full rounded-lg border border-line bg-white px-4 py-3.5 text-base text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

  return (
    <div className="rounded-2xl border border-line bg-panel p-5 shadow-sm sm:p-6">
      {step === 1 ? (
        <form onSubmit={handleStep1} noValidate>
          <label
            htmlFor={`${idPrefix}-address`}
            className="mb-2 block text-sm font-semibold text-ink"
          >
            Where's the property?
          </label>
          <AddressAutocomplete
            inputId={`${idPrefix}-address`}
            value={address}
            onChange={(v) => {
              setAddress(v);
              setPlaceId("");
            }}
            onSelect={(addr, pid) => {
              setAddress(addr);
              setPlaceId(pid);
            }}
          />
          {error === "fields" && (
            <p className="mt-2 text-sm text-red-700">
              Please enter the property address.
            </p>
          )}
          <button
            type="submit"
            className="mt-3 w-full rounded-lg bg-accent px-6 py-4 text-lg font-bold text-white transition-colors hover:bg-accent-hover"
          >
            Get My Fair Cash Offer →
          </button>
          <p className="mt-2.5 text-center text-xs text-ink-soft">
            Takes 30 seconds · No obligation · Never sold or sent to other
            investors
          </p>
        </form>
      ) : (
        <form onSubmit={handleStep2} noValidate>
          <p className="mb-1 text-sm font-semibold text-trust">
            Step 2 of 2 — almost done
          </p>
          <p className="mb-4 truncate text-sm text-ink-soft" title={address}>
            {address}
          </p>
          <div className="space-y-3">
            <input
              type="text"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              required
              aria-label="Your name"
            />
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="Mobile phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputCls}
              required
              aria-label="Mobile phone"
            />
            <label className="flex cursor-pointer items-start gap-2.5 pt-1">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-line accent-accent"
                style={{ minHeight: "1.25rem" }}
              />
              <span className="text-xs leading-relaxed text-ink-soft">
                {CONSENT_TEXT}
              </span>
            </label>
          </div>
          {error === "fields" && (
            <p className="mt-2 text-sm text-red-700">
              Please add your name and a valid mobile number.
            </p>
          )}
          {error === "consent" && (
            <p className="mt-2 text-sm text-red-700">
              Please check the box so we're allowed to contact you about your
              offer.
            </p>
          )}
          {error === "delivery" && (
            <p className="mt-2 text-sm text-red-700">
              Something went wrong sending your info — please call or text{" "}
              {site.principal.firstName} directly at{" "}
              <PhoneLink className="font-semibold underline" /> and we'll take
              it from there.
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-lg bg-accent px-6 py-4 text-lg font-bold text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? "Sending…" : "Get My Offer"}
          </button>
          <p className="mt-2.5 text-center text-xs text-ink-soft">
            {site.principal.firstName} personally reviews every request —
            expect a call or text the same day ({site.phone.hours}).
          </p>
        </form>
      )}
    </div>
  );
}
