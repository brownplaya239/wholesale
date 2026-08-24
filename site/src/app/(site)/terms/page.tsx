import type { Metadata } from "next";
import LicensureNote from "@/components/Licensure";
import { Section } from "@/components/Sections";
import { entityName, site } from "@/config/site";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: `Terms of use for ${site.name}.`,
};

/** TODO: attorney review before scaling ad spend. */
export default function TermsPage() {
  return (
    <Section>
      <div className="mx-auto max-w-2xl space-y-5 text-sm leading-relaxed text-ink-soft">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">
          Terms of Use
        </h1>
        <p>Effective date: August 13, 2026 · {entityName()}</p>

        <h2 className="text-lg font-bold text-ink">What this site is</h2>
        <p>
          This website lets New Jersey property owners request a cash offer or
          a listing consultation from {entityName()}. Submitting the form is
          not a contract, does not obligate you to sell, and does not obligate
          us to buy. Every actual offer is made separately, in writing.
        </p>

        <h2 className="text-lg font-bold text-ink">No advice</h2>
        <p>
          Content on this site — including explanations of NJ probate,
          foreclosure, tenancy, and tax topics — is general information, not
          legal, tax, or financial advice. Talk to your attorney or accountant
          about your specific situation; in NJ real estate transactions you
          should always have your own attorney.
        </p>

        <h2 className="text-lg font-bold text-ink">License disclosure</h2>
        <p>
          {site.principal.fullName} is a {site.principal.licenseLine}
          {site.principal.brokerage && <> with {site.principal.brokerage}</>}
          {site.principal.licenseNumber && <> (License #{site.principal.licenseNumber})</>}
          , and may purchase property as a principal. License status is
          disclosed at first contact and in any contract. <LicensureNote />
        </p>

        <h2 className="text-lg font-bold text-ink">Accuracy</h2>
        <p>
          We work to keep this site accurate, but market conditions and NJ law
          change; we make no warranties about completeness and may update
          content at any time.
        </p>

        <h2 className="text-lg font-bold text-ink">Contact</h2>
        <p>
          {entityName()}
          {site.legal.officeAddress && <> · {site.legal.officeAddress}</>} ·{" "}
          {site.phone.display} · {site.email}
        </p>
      </div>
    </Section>
  );
}
