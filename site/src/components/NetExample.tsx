import { Section, SectionTitle } from "@/components/Sections";

/**
 * Worked two-numbers example (hypothetical house). Every figure derives from
 * EXAMPLE, so the columns always add up. The cash offer MUST stay in line
 * with how offers are really priced — an example that outprices real offers
 * turns every first call into a bait-and-switch.
 */
const EXAMPLE = {
  valueFixedUp: 425_000,
  repairs: 35_000,
  /** 70% of fixed-up value, minus repairs. */
  cashOffer: 262_500,
  cashClosingCosts: 3_000,
  /** Negotiable — shown only to illustrate the math. */
  commissionRate: 0.05,
  listClosingCosts: 6_000,
  carryingMonths: 5,
  carryingPerMonth: 2_500,
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
        {lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-ink-soft">
              {l.label}
              {l.note && <span className="block text-xs text-ink-soft/80">{l.note}</span>}
            </dt>
            <dd className={`shrink-0 font-semibold tabular-nums ${l.amount < 0 ? "text-ink-soft" : "text-ink"}`}>
              {l.amount < 0 ? `−${usd(-l.amount)}` : usd(l.amount)}
            </dd>
          </div>
        ))}
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
  const commission = Math.round(e.valueFixedUp * e.commissionRate);
  const carrying = e.carryingMonths * e.carryingPerMonth;
  const cashNet = e.cashOffer - e.cashClosingCosts;
  const listNet = e.valueFixedUp - e.repairs - commission - e.listClosingCosts - carrying;
  const gap = listNet - cashNet;

  return (
    <Section tinted>
      <SectionTitle>What "both numbers" looks like</SectionTitle>
      <p className="mx-auto max-w-2xl text-center text-ink-soft">
        A hypothetical NJ house worth about {usd(e.valueFixedUp)} fixed up,
        needing about {usd(e.repairs)} of work.
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
            { label: "Your closing costs", note: "NJ transfer fee, attorney (est.)", amount: -e.cashClosingCosts },
          ]}
          net={cashNet}
          facts={[
            "Close in as little as 2–3 weeks, on the date you pick",
            "Nothing out of pocket before closing",
            "No buyer financing or inspection to fall through",
          ]}
        />
        <Column
          title="Fix up, then list"
          subtitle="On the open market with an agent"
          lines={[
            { label: "Sale price after repairs", amount: e.valueFixedUp },
            { label: "Repairs before listing", note: "Paid by you, up front", amount: -e.repairs },
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
            `Typically ${e.carryingMonths - 1}–${e.carryingMonths + 1} months from start to closing`,
            `About ${usd(e.repairs)} out of pocket before you sell`,
            "Repair overruns and inspection renegotiations come out of your net",
          ]}
        />
      </div>

      <div className="mx-auto mt-5 max-w-3xl rounded-2xl border border-line bg-panel p-5 text-center">
        <p className="font-bold">
          In this example, listing nets about {usd(gap)} more — in exchange
          for months of time, money up front, and the risk.
        </p>
        <p className="mx-auto mt-1.5 max-w-2xl text-sm text-ink-soft">
          Neither is always right. For a house in good shape, listing usually
          wins. For a house that needs work, a tight timeline, or a situation
          you just want finished, cash often does. That's why you get both
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
