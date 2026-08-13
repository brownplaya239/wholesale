import type { Metadata } from "next";
import LeadForm from "@/components/LeadForm";
import { Section, SectionTitle } from "@/components/Sections";
import { site } from "@/config/site";

export const metadata: Metadata = {
  title: "Reviews",
  description: `What NJ sellers say about working with ${site.name} — verifiable Google reviews, linked, not screenshotted.`,
};

/**
 * Reviews are only shown when they're real and linkable (spec §5). Until the
 * Google Business Profile has reviews, this page says so honestly — which is
 * itself a trust signal — instead of showing fabricated quotes.
 */
export default function ReviewsPage() {
  const hasReviews =
    site.proof.googleReviewCount > 0 && site.proof.googleReviewUrl;

  return (
    <>
      <Section>
        <h1 className="text-balance text-center text-4xl font-extrabold tracking-tight">
          Reviews
        </h1>
        {hasReviews ? (
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-line bg-white p-6 text-center">
            <p aria-hidden className="text-2xl text-amber-500">★★★★★</p>
            <p className="mt-2 text-lg font-bold">
              {site.proof.googleRating.toFixed(1)} on Google ·{" "}
              {site.proof.googleReviewCount} reviews
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              Every review below links to Google — check them yourself. We
              don't screenshot, cherry-pick, or invent.
            </p>
            <a
              href={site.proof.googleReviewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn mt-5 inline-flex items-center justify-center rounded-lg bg-accent px-6 py-3 font-bold text-white transition-colors hover:bg-accent-hover"
            >
              Read our Google reviews →
            </a>
          </div>
        ) : (
          <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-line bg-white p-6 text-center">
            <p className="text-lg font-semibold">
              We only show reviews we can prove.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              A lot of sites in this business paste five-star quotes with
              initials under them. We won't do that. As sellers we've worked
              with leave public Google reviews, they'll appear here — linked to
              Google, where we can't edit them. In the meantime, judge us the
              way we'd want you to anyway: talk to {site.principal.firstName},
              ask hard questions, and ask for references.
            </p>
          </div>
        )}
      </Section>

      <Section tinted>
        <SectionTitle>Judge for yourself</SectionTitle>
        <div className="mx-auto max-w-xl scroll-mt-4" data-lead-form-anchor>
          <LeadForm idPrefix="reviews" />
        </div>
      </Section>
    </>
  );
}
