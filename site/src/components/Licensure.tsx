/**
 * NJ REC advertising disclaimer — rendered immediately after every visible
 * reference to real-estate licensure, sitewide, via this one component.
 */
export default function LicensureNote({
  className = "",
}: {
  className?: string;
}) {
  return (
    <span className={`text-[11px] leading-tight text-ink-soft/80 ${className}`}>
      Licensure does not imply endorsement.
    </span>
  );
}
