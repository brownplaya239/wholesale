import { Section, SectionTitle } from "@/components/Sections";

/**
 * Worked two-numbers example (hypothetical house). Every figure derives from
 * EXAMPLE, so the columns always add up. The cash offer MUST stay in line
 * with how offers are really priced — an example that outprices real offers
 * turns every first call into a bait-and-switch.
 */
const EXAMPLE = {
  valueFixedUp: 500_000,
  repairs: 50_000,
  /** 70% of fixed-up value, minus repairs. */
  cashOffer: 300_000,
  /** "Typical seller closing costs covered" — see HonestBroker. */
  cashClosingCosts: 0,
  /** Sold as-is on the MLS: buyers discount a bit beyond the repair cost. */
  listPriceAsIs: 440_000,
  /** Negotiable — shown only to illustrate the math. */
  commissionRate: 0.05,
  listClosingCosts: 9_000,
  carryingMonths: 3,
  carryingPerMonth: 3_000,
};

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type Line = { label: string; note?: string; amount: number };

function Column({
  title,
  subtitle,
  lines,
  net,
  facts,
}: {
  title: string;
  subtitle: string;
  lines: Line[];
  net: number;
  facts: string[];
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-white p-5">
      <p className="text-lg font-bold">{title}</p>
      <p className="text-sm text-ink-soft">{subtitle}</p>
      <dl className="mt-4 space-y-2 text-sm">
        {lines.map((l) => {
          const amount = l.amount || 0; // a zero deduction arrives as −0; print it as $0
          return (
            <div key={l.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-soft">
                {l.label}
                {l.note && <span className="block text-xs text-ink-soft/80">{l.note}</span>}
              </dt>
              <dd className={`shrink-0 font-semibold tabular-nums ${amount < 0 ? "text-ink-soft" : "text-ink"}`}>
                {amount < 0 ? `−${usd(-amount)}` : usd(amount)}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="mt-4 flex items-baseline justify-between border-t border-line pt-3">
        <p className="font-bold">Estimated net to you</p>
        <p className="text-xl font-extrabold tabular-nums">{usd(net)}</p>
      </div>
      <ul className="mt-4 space-y-1.5 text-sm text-ink-soft">
        {facts.map((f) => (
          <li key={f} className="flex gap-2">
            <span aria-hidden className="text-ink-soft/60">·</span>
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NetExample() {
  const e = EXAMPLE;
  const commission = Math.round(e.listPriceAsIs * e.commissionRate);
  const carrying = e.carryingMonths * e.carryingPerMonth;
  const cashNet = e.cashOffer - e.cashClosingCosts;
  const listNet = e.listPriceAsIs - commission - e.listClosingCosts - carrying;
  const gap = listNet - cashNet;

  return (
    <Section tinted>
      <SectionTitle>What "both numbers" looks like</SectionTitle>
      <p className="mx-auto max-w-2xl text-center text-ink-soft">
        A hypothetical NJ house that needs about {usd(e.repairs)} of work —
        worth about {usd(e.valueFixedUp)} fixed up, or about{" "}
        {usd(e.listPriceAsIs)} as-is on the market.
      </p>
      <p className="mx-auto mt-2 w-fit rounded-full bg-cream px-3 py-1 text-xs font-semibold text-ink-soft">
        Illustrative example — not an offer
      </p>

      <div className="mx-auto mt-7 grid max-w-3xl gap-4 sm:grid-cols-2">
        <Column
          title="Sell as-is for cash"
          subtitle="No repairs, no showings, no cleanout"
          lines={[
            { label: "Written cash offer", amount: e.cashOffer },
            { label: "Repairs & cleanout", amount: 0 },
            { label: "Agent commission", amount: 0 },
            { label: "Your typical closing costs", note: "Covered in the cash sale", amount: -e.cashClosingCosts },
          ]}
          net={cashNet}
          facts={[
            "Close in as little as 2–3 weeks, on the date you pick",
            "Nothing out of pocket before closing",
            "No buyer financing or inspection to fall through",
          ]}
        />
        <Column
          title="Sell as-is on the MLS"
          subtitle="Listed on the open market with an agent"
          lines={[
            { label: "Sale price as-is", note: "What buyers typically pay for this condition", amount: e.listPriceAsIs },
            {
              label: "Agent commission",
              note: `Negotiable — ${Math.round(e.commissionRate * 100)}% used for illustration`,
              amount: -commission,
            },
            { label: "Your closing costs", note: "NJ transfer fee, attorney, title (est.)", amount: -e.listClosingCosts },
            {
              label: "Carrying costs",
              note: `~${e.carryingMonths} months of mortgage, taxes, insurance, utilities`,
              amount: -carrying,
            },
          ]}
          net={listNet}
          facts={[
            `Typically ${e.carryingMonths - 1}–${e.carryingMonths + 1} months from listing to closing`,
            "Showings, open houses, and keeping the house market-ready",
            "Buyer inspection and financing can reopen the price — or fall through",
          ]}
        />
      </div>

      <div className="mx-auto mt-5 max-w-3xl rounded-2xl border border-line bg-panel p-5 text-center">
        <p className="font-bold">
          In this example, listing nets about {usd(gap)} more — in exchange
          for a few months on the market, showings, and the risk the sale
          falls through.
        </p>
        <p className="mx-auto mt-1.5 max-w-2xl text-sm text-ink-soft">
          Neither is always right. If you have time and the house can get
          through a buyer's inspection and financing, listing usually nets
          more. If you need speed, certainty, or a situation you just want
          finished, cash often makes more sense. That's why you get both
          numbers for your actual house — and a straight answer about which
          makes more sense.
        </p>
        <a
          href="#top-form"
          className="mt-4 inline-block rounded-lg bg-accent px-6 py-3.5 font-bold text-white transition-colors hover:bg-accent-hover"
        >
          Get both numbers for my house →
        </a>
      </div>
    </Section>
  );
}
