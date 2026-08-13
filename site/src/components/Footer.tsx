import Link from "next/link";
import PhoneLink from "@/components/PhoneLink";
import { entityName, site } from "@/config/site";
import { counties } from "@/data/counties";
import { situations } from "@/data/situations";

/**
 * Footer facts (spec §5): entity, address, phone, email, brokerage, license
 * disclosure, privacy/terms. Anonymous footers kill trust at the exact moment
 * a cautious seller scrolls down to check.
 *
 * `minimal` variant for landing pages: identity facts + privacy only — no
 * link farm (spec §1: the only exits are form, phone, privacy).
 */
export default function Footer({ minimal = false }: { minimal?: boolean }) {
  return (
    <footer className="border-t border-line bg-white">
      <div className="mx-auto max-w-5xl px-4 py-8">
        {!minimal && (
          <div className="mb-8 grid gap-8 sm:grid-cols-3">
            <div>
              <p className="mb-2.5 text-sm font-bold">Where we buy</p>
              <ul className="grid grid-cols-2 gap-1.5 text-sm text-ink-soft sm:grid-cols-1 md:grid-cols-2">
                {counties.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/${c.slug}`} className="hover:text-ink hover:underline">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2.5 text-sm font-bold">Situations we help with</p>
              <ul className="space-y-1.5 text-sm text-ink-soft">
                {situations.map((s) => (
                  <li key={s.slug}>
                    <Link href={`/${s.slug}`} className="hover:text-ink hover:underline">
                      {s.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2.5 text-sm font-bold">Company</p>
              <ul className="space-y-1.5 text-sm text-ink-soft">
                <li><Link href="/how-it-works" className="hover:text-ink hover:underline">How it works</Link></li>
                <li><Link href="/reviews" className="hover:text-ink hover:underline">Reviews</Link></li>
                <li><Link href="/about" className="hover:text-ink hover:underline">About {site.principal.firstName}</Link></li>
              </ul>
            </div>
          </div>
        )}

        <div className="space-y-1.5 border-t border-line pt-6 text-center text-xs leading-relaxed text-ink-soft">
          <p className="font-semibold text-ink">{entityName()}</p>
          {site.legal.officeAddress && <p>{site.legal.officeAddress}</p>}
          <p>
            <PhoneLink className="hover:underline" /> ·{" "}
            <a href={`mailto:${site.email}`} className="hover:underline">
              {site.email}
            </a>
          </p>
          <p>
            {site.principal.fullName}, {site.principal.licenseLine}
            {site.principal.licenseNumber && ` · License #${site.principal.licenseNumber}`}
            {site.principal.brokerage && ` · ${site.principal.brokerage}`}
          </p>
          <p>
            We buy houses directly and, where it serves you better, offer
            licensed listing services. All offers are made in writing with
            proof of funds; NJ contracts are attorney-reviewed.
          </p>
          <p className="pt-1.5">
            © {new Date().getFullYear()} {entityName()} ·{" "}
            <Link href="/privacy" className="underline hover:text-ink">
              Privacy Policy
            </Link>{" "}
            ·{" "}
            <Link href="/terms" className="underline hover:text-ink">
              Terms
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
