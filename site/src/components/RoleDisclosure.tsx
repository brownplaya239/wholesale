import LicensureNote from "@/components/Licensure";
import { site } from "@/config/site";

/**
 * The three ways a deal can go, and how we're paid in each. Any copy that
 * says who buys the house must stay consistent with this block — never claim
 * a direct purchase unconditionally.
 */
export default function RoleDisclosure({ className = "" }: { className?: string }) {
  const p = site.principal;
  return (
    <div className={`rounded-2xl border border-line bg-white p-5 text-left text-sm text-ink-soft ${className}`}>
      <p className="font-bold text-ink">How we can help — and how we're paid</p>
      <p className="mt-1">
        Depending on your property, one of three things happens, and you'll
        know which in writing before you sign anything:
      </p>
      <ul className="mt-3 space-y-2">
        <li>
          <strong className="text-ink">We buy it ourselves.</strong>{" "}
          {p.firstName}'s company purchases houses directly, with proof of
          funds.
        </li>
        <li>
          <strong className="text-ink">We bring in an investor partner.</strong>{" "}
          Your contract will be assigned to an investor we work with, who
          closes at the price and terms you agreed to, and the investor pays us
          a fee for arranging the purchase.
        </li>
        <li>
          <strong className="text-ink">We list it for you.</strong> {p.firstName}{" "}
          represents you as your listing agent through {p.brokerage}, for a
          commission you negotiate.
        </li>
      </ul>
      <p className="mt-3">
        In every case, {p.fullName} is a {p.licenseLine} (#{p.licenseNumber})
        with {p.brokerage}. <LicensureNote />
      </p>
    </div>
  );
}
