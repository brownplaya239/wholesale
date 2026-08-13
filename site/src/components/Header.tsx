import Link from "next/link";
import PhoneLink from "@/components/PhoneLink";
import { site } from "@/config/site";

/**
 * Main-site navigation. Landing pages (/lp/*) never render this — their only
 * exits are the form, the phone number, and the privacy policy (spec §1).
 */
const nav = [
  { href: "/how-it-works", label: "How It Works" },
  { href: "/reviews", label: "Reviews" },
  { href: "/about", label: "About" },
];

export default function Header() {
  return (
    <header className="border-b border-line bg-cream">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5">
        <Link href="/" className="text-lg font-extrabold tracking-tight">
          House<span className="text-accent">Sold</span>NJ
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-ink-soft sm:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="hover:text-ink">
              {item.label}
            </Link>
          ))}
        </nav>
        <PhoneLink className="rounded-lg border border-accent px-3.5 py-2 text-sm font-bold text-accent transition-colors hover:bg-accent hover:text-white">
          <span className="dni-phone">{site.phone.display}</span>
        </PhoneLink>
      </div>
    </header>
  );
}
