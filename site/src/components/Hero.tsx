import LeadForm from "@/components/LeadForm";
import PhoneLink from "@/components/PhoneLink";
import TrustStrip from "@/components/TrustStrip";
import { site } from "@/config/site";

/**
 * Above the fold (spec §3): headline with geo token, honest subhead, the
 * one-field form, the phone number, and the trust strip. The page IS this.
 */
export default function Hero({
  headline,
  subhead,
  idPrefix = "hero",
}: {
  headline: string;
  subhead?: string;
  idPrefix?: string;
}) {
  return (
    <section className="mx-auto w-full max-w-3xl px-4 pb-10 pt-10 sm:pt-16">
      <h1 className="text-balance text-center text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
        {headline}
      </h1>
      <p className="mx-auto mt-4 max-w-2xl text-balance text-center text-lg text-ink-soft sm:text-xl">
        {subhead ??
          "Fair cash offer within 24 hours. No fees, no repairs, no obligation. Or, if listing would net you more — we'll tell you honestly."}
      </p>
      <div id="top-form" className="mx-auto mt-7 max-w-xl scroll-mt-4" data-lead-form-anchor>
        <LeadForm idPrefix={idPrefix} />
        <p className="mt-4 text-center text-sm text-ink-soft">
          Or call/text {site.principal.firstName} directly:{" "}
          <PhoneLink className="font-bold text-ink underline decoration-accent decoration-2 underline-offset-2" />
        </p>
        <div className="mt-5">
          <TrustStrip />
        </div>
      </div>
    </section>
  );
}
