import LicensureNote from "@/components/Licensure";
import PhoneLink from "@/components/PhoneLink";
import { site } from "@/config/site";

/** Shared section shell — generous whitespace, calm rhythm. */
export function Section({
  children,
  tinted = false,
  id,
}: {
  children: React.ReactNode;
  tinted?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={tinted ? "bg-white" : undefined}>
      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">{children}</div>
    </section>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-6 text-balance text-center text-3xl font-extrabold tracking-tight">
      {children}
    </h2>
  );
}

/**
 * The honest-broker positioning (spec §5) — the one thing nobody else in the
 * ad auction can say. Converts skeptics who'd never call a bandit sign.
 */
export function HonestBroker() {
  return (
    <Section tinted>
      <SectionTitle>Two ways we can help — you choose</SectionTitle>
      <p className="mx-auto mb-8 max-w-2xl text-center text-ink-soft">
        {site.principal.firstName} is a licensed NJ real estate agent who also
        buys homes directly. You'll see both options side by side so you can
        choose what makes the most sense for you.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-cream p-6">
          <p className="mb-1 text-sm font-bold uppercase tracking-wide text-accent">
            Option 1 · Sell for cash
          </p>
          <p className="mb-3 text-sm font-medium text-ink">
            Best for speed, convenience, and certainty
          </p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li>Sell completely as-is</li>
            <li>No repairs, cleanout, or showings</li>
            <li>Close in as little as 2–3 weeks, or choose your date</li>
            <li>No agent commission on the cash sale</li>
            <li>Typical seller closing costs covered</li>
            <li>Written offer with proof of funds</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-line bg-cream p-6">
          <p className="mb-1 text-sm font-bold uppercase tracking-wide text-trust">
            Option 2 · List your home
          </p>
          <p className="mb-3 text-sm font-medium text-ink">
            Best when maximizing your net proceeds matters most
          </p>
          <ul className="space-y-2 text-sm text-ink-soft">
            <li>Full-service NJ listing representation</li>
            <li>Honest pricing based on current market conditions</li>
            <li>Commission and estimated selling costs clearly shown</li>
            <li>Your expected listing proceeds shown beside the cash offer</li>
            <li>If listing looks like the better financial option, we'll tell you</li>
            <li>No obligation to choose either route</li>
          </ul>
        </div>
      </div>
      <p className="mt-8 text-center text-lg font-bold tracking-tight">
        One conversation. Two numbers. You decide.
      </p>
      <p className="mx-auto mt-4 max-w-2xl text-center text-xs leading-relaxed text-ink-soft">
        In a cash purchase, {site.name} acts as the buyer for its own account —
        not as your real estate agent. If you choose to list, brokerage
        services are provided separately through {site.principal.brokerage}{" "}
        under a written brokerage agreement. <LicensureNote />
      </p>
    </Section>
  );
}

/**
 * Transparent process + math (spec §5). Sellers don't expect retail; they
 * distrust black boxes.
 */
export function OfferMath() {
  return (
    <Section>
      <SectionTitle>How we calculate your offer</SectionTitle>
      <p className="mx-auto mb-8 max-w-2xl text-center text-ink-soft">
        No black box. Every offer is built from the same simple math, and we
        show you every line:
      </p>
      <div className="mx-auto max-w-xl space-y-3">
        {[
          {
            n: "1",
            t: "What your house would sell for fixed up",
            d: "Real market value, from recent sales of comparable homes near you — we'll show you which ones.",
          },
          {
            n: "2",
            t: "Minus the cost of repairs",
            d: "An itemized repair budget, not a scary lump sum. You see the line items.",
          },
          {
            n: "3",
            t: "Minus transaction, holding, and risk costs",
            d: "Closing costs on both ends, carrying costs during the work, and a cushion for surprises — itemized, not lumped.",
          },
          {
            n: "4",
            t: "Minus our return",
            d: "We're a business and we're honest about it — the return we need is a line on the sheet, not hidden in the price.",
          },
        ].map((row) => (
          <div key={row.n} className="flex gap-4 rounded-xl border border-line bg-white p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-bold text-white">
              {row.n}
            </div>
            <div>
              <p className="font-semibold">{row.t}</p>
              <p className="mt-0.5 text-sm text-ink-soft">{row.d}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-7 max-w-xl text-center text-sm text-ink-soft">
        Every offer comes in writing, with proof of funds, on an
        attorney-reviewed NJ contract.
      </p>
    </Section>
  );
}

/**
 * A real human, immediately (spec §1/§5): Sum's face, name, license status,
 * brokerage. Compliance requirement and conversion asset are the same element.
 */
export function AboutSum({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      {/* eslint-disable-next-line @next/next/no-img-element -- 112px avatar; optimizer overhead isn't worth it */}
      <img
        src={site.principal.photo}
        alt={`${site.principal.fullName}, ${site.principal.licenseLine}`}
        width={112}
        height={112}
        className="h-28 w-28 rounded-full border-2 border-line object-cover"
      />
      <div className="text-center sm:text-left">
        <p className="text-lg font-bold">{site.principal.fullName}</p>
        <p className="text-sm font-medium text-trust">
          {site.principal.licenseLine}
          {site.principal.brokerage && ` · ${site.principal.brokerage}`}
        </p>
        <p>
          <LicensureNote />
        </p>
        <p className="text-sm text-ink-soft">{site.principal.base}</p>
        {!compact && (
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-soft">
            You'll deal with me directly — not a call center, not a lead
            reseller. I'll look at your property, walk you through both numbers
            honestly, and you'll have my cell. If we're not the right fit, I'll
            tell you that too.
          </p>
        )}
        <p className="mt-3 text-sm">
          Call or text me directly:{" "}
          <PhoneLink className="font-bold text-ink underline decoration-accent decoration-2 underline-offset-2" />
        </p>
      </div>
    </div>
  );
}

/** How-it-works, 3 steps — used on the main page and /how-it-works. */
export function ProcessSteps() {
  const steps = [
    {
      t: "Tell us about the property",
      d: "30 seconds online, or one phone call. No obligation, and your info stays with us.",
    },
    {
      t: "Get both numbers — typically within 24 hours",
      d: "A written cash offer with proof of funds — and what we think listing would net you instead. Compare honestly.",
    },
    {
      t: "Close on your timeline",
      d: "Take the cash offer and pick your closing date (as fast as 2–3 weeks), list it with us, or walk away. All three are fine.",
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {steps.map((s, i) => (
        <div key={s.t} className="rounded-2xl border border-line bg-white p-5">
          <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
            {i + 1}
          </div>
          <p className="font-semibold">{s.t}</p>
          <p className="mt-1 text-sm text-ink-soft">{s.d}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * Lazy YouTube embed (spec §5/§7) — only renders when a real video ID exists;
 * click-to-load so no YouTube payload touches LCP.
 */
export function IntroVideo() {
  if (!site.introVideoId) return null;
  return (
    <div className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-line">
      <iframe
        loading="lazy"
        className="aspect-video w-full"
        src={`https://www.youtube-nocookie.com/embed/${site.introVideoId}`}
        title={`Meet ${site.principal.firstName} — ${site.name}`}
        allow="accelerometer; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  );
}
