import { site } from "@/config/site";

/**
 * Trust strip directly under the form (spec §3). Proof numbers only render
 * when real values exist in config — nothing on this strip may be fake.
 */
export default function TrustStrip() {
  const items: React.ReactNode[] = [];

  if (site.proof.googleReviewCount > 0 && site.proof.googleReviewUrl) {
    items.push(
      <a
        key="reviews"
        href={site.proof.googleReviewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 hover:underline"
      >
        <span aria-hidden className="text-amber-500">
          ★★★★★
        </span>
        <span>
          {site.proof.googleRating.toFixed(1)} · {site.proof.googleReviewCount}{" "}
          Google reviews
        </span>
      </a>
    );
  }

  items.push(
    <span key="license" className="flex items-center gap-1.5">
      <Check /> {site.principal.licenseLine}
    </span>,
    <span key="local" className="flex items-center gap-1.5">
      <Check /> Local — {site.principal.base.replace("Based in ", "based in ")}
    </span>
  );

  if (site.proof.housesBought > 0) {
    items.push(
      <span key="bought" className="flex items-center gap-1.5">
        <Check /> {site.proof.housesBought} houses bought in NJ
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-ink-soft">
      {items}
    </div>
  );
}

function Check() {
  return (
    <svg
      aria-hidden
      className="h-4 w-4 shrink-0 text-trust"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.79 6.8-6.8a1 1 0 0 1 1.4 0Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
