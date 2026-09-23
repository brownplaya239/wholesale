"use client";

import { useEffect, useState } from "react";
import { site } from "@/config/site";
import { trackEvent } from "@/lib/analytics";
import { recallLead, type RememberedLead } from "@/lib/lead";

const TIMELINES = ["ASAP", "1–3 months", "3+ months", "Just curious"];

const PRIORITIES = [
  "Speed & certainty",
  "Highest net proceeds",
  "No repairs or cleanup",
  "Not sure — compare options",
];

/**
 * Optional prep questions, asked only AFTER the lead is captured — the form
 * itself stays at name + phone. Renders nothing without a just-submitted lead.
 */
export default function LeadDetails() {
  const [lead, setLead] = useState<RememberedLead | null>(null);
  const [timeline, setTimeline] = useState("");
  const [priority, setPriority] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  useEffect(() => setLead(recallLead()), []);

  if (!lead) return null;

  if (state === "sent") {
    return (
      <div className="mt-8 rounded-2xl border border-trust/30 bg-trust/5 p-5 text-left">
        <p className="font-bold text-trust">
          Thanks — {site.principal.firstName} will have this in hand before
          your call.
        </p>
      </div>
    );
  }

  const canSend = Boolean(timeline || priority || email.trim());

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!lead || !canSend) return;
    setState("sending");
    try {
      await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stage: "details",
          leadId: lead.leadId,
          name: lead.name,
          address: lead.address,
          timeline,
          priority,
          email: email.trim(),
          pageUrl: window.location.href,
        }),
      });
    } catch {
      // The lead itself is already delivered — extras are best-effort.
    }
    trackEvent("lead_details_added", { timeline, priority, email: Boolean(email.trim()) });
    setState("sent");
  }

  const chip = (active: boolean) =>
    `rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
      active
        ? "border-accent bg-accent/10 text-accent"
        : "border-line bg-white text-ink-soft hover:border-ink-soft"
    }`;

  return (
    <form onSubmit={send} className="mt-8 rounded-2xl border border-line bg-panel p-5 text-left">
      <p className="font-bold">
        Optional: help {site.principal.firstName} come prepared
      </p>
      <p className="mt-1 text-sm text-ink-soft">
        A couple of taps now means a shorter, more useful call. Skip anything
        you like.
      </p>

      <p className="mb-1.5 mt-4 text-sm font-semibold text-ink">
        When do you need to sell?
      </p>
      <div className="grid grid-cols-2 gap-2">
        {TIMELINES.map((t) => (
          <button key={t} type="button" onClick={() => setTimeline(timeline === t ? "" : t)} className={chip(timeline === t)}>
            {t}
          </button>
        ))}
      </div>

      <p className="mb-1.5 mt-4 text-sm font-semibold text-ink">
        What matters most to you?
      </p>
      <div className="grid grid-cols-2 gap-2">
        {PRIORITIES.map((p) => (
          <button key={p} type="button" onClick={() => setPriority(priority === p ? "" : p)} className={chip(priority === p)}>
            {p}
          </button>
        ))}
      </div>

      <input
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="Email (optional)"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email (optional)"
        className="mt-4 w-full rounded-lg border border-line bg-white px-4 py-3.5 text-base text-ink placeholder:text-ink-soft/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
      />

      <button
        type="submit"
        disabled={!canSend || state === "sending"}
        className="mt-4 w-full rounded-lg bg-ink px-6 py-3.5 text-base font-bold text-white transition-opacity disabled:opacity-40"
      >
        {state === "sending" ? "Sending…" : `Send to ${site.principal.firstName}`}
      </button>
    </form>
  );
}
