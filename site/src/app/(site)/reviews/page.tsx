import type { Metadata } from "next";
import LeadForm from "@/components/LeadForm";
import PhoneLink from "@/components/PhoneLink";
import { Section, SectionTitle } from "@/components/Sections";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Verify Us",
  description: `Check ${site.name} out before you trust us: verify Sumeet Sancheti's NJ real estate license, the ${site.principal.brokerage} affiliation, and what every written offer includes.`,
};

/**
 * Until real Google reviews accrue, this page is a verification kit instead
 * of an empty reviews page (an empty one just announces "no reviews yet").
 * The review badge section auto-appears once real numbers exist in config.
 */
export default function VerifyPage() {
  const hasReviews =
    site.proof.googleReviewCount > 0 && site.proof.googleReviewUrl;

  return (
    <>
      <Section>
        <h1 className="text-balance text-center text-4xl font-extrabold tracking-tight">
          Verify us before you trust us
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-center text-lg text-ink-soft">
          You should check out anyone who offers to buy your house. Here's
          exactly how to check us out — using sources we can't edit.
        </p>

        {hasReviews && (
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-line bg-white p-6 text-center">
            <p aria-hidden className="text-2xl text-amber-500">★★★★★</p>
            <p className="mt-2 text-lg font-bold">
              {site.proof.googleRating.toFixed(1)} on Google ·{" "}
              {site.proof.googleReviewCount} reviews
            </p>
            <a
              href={site.proof.googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn mt-4 inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 font-bold text-white transition-colors hover:bg-accent-hover"
            >
              Read our Google reviews →
            </a>
          </div>
        )}

        <div className="mx-auto mt-10 max-w-xl space-y-4">
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">1 · Verify the real estate license</p>
            <p className="mt-1 text-sm text-ink-soft">
              Search <span className="font-semibold text-ink">Sumeet Sancheti</span>{" "}
              (License #{site.principal.licenseNumber}) on the State of New
              Jersey's official license verification site:{" "}
              <a
                href="https://newjersey.mylicense.com/verification/"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-ink underline"
              >
                newjersey.mylicense.com/verification
              </a>
              . That's the state's database — we can't touch it.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">2 · Verify the brokerage</p>
            <p className="mt-1 text-sm text-ink-soft">
              Sumeet is licensed with {site.principal.brokerage},
              Monmouth-Ocean Regional Office, 335 Route 9 South, Manalapan, NJ
              07726. Call the office directly at (732) 462-4242 and ask for
              him by name.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">3 · Know what a real offer looks like</p>
            <ul className="mt-1 list-inside list-disc text-sm text-ink-soft">
              <li>Always in writing — never a number floated over the phone</li>
              <li>Proof of funds attached</li>
              <li>An attorney-reviewed New Jersey contract</li>
              <li>
                The full price breakdown: market value, repairs, costs, and
                our return — plus what listing would likely net you instead
              </li>
            </ul>
            <p className="mt-2 text-sm text-ink-soft">
              If anyone — including us — won't put those four things in front
              of you, walk away.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5">
            <p className="font-bold">4 · Talk to the actual person</p>
            <p className="mt-1 text-sm text-ink-soft">
              No call centers. Call or text Sumeet directly at{" "}
              <PhoneLink className="font-semibold text-ink underline" /> or
              email{" "}
              <a href={`mailto:${site.email}`} className="font-semibold text-ink underline">
                {site.email}
              </a>
              . Ask hard questions.
            </p>
          </div>
        </div>

        {!hasReviews && (
          <p className="mx-auto mt-8 max-w-xl text-center text-sm text-ink-soft">
            As sellers we work with leave public Google reviews, they'll
            appear here — linked to Google, where we can't edit them. We don't
            paste five-star quotes with initials under them, and we never
            will.
          </p>
        )}
      </Section>

      <Section tinted>
        <SectionTitle>Checked us out? Let's talk.</SectionTitle>
        <div className="mx-auto max-w-xl scroll-mt-4" data-lead-form-anchor>
          <LeadForm idPrefix="verify" />
        </div>
      </Section>
    </>
  );
}
