import Footer from "@/components/Footer";
import PhoneLink from "@/components/PhoneLink";
import StickyCtaBar from "@/components/StickyCtaBar";
import { site } from "@/config/site";

/**
 * Landing-page chrome (spec §1): NO nav menu, no link farm. The only exits
 * are the form, the phone number, and the privacy/identity footer. Logo is
 * deliberately not a link.
 */
export default function LandingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <header className="border-b border-line bg-cream">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5">
          <span className="text-lg font-extrabold tracking-tight">
            House<span className="text-accent">Sold</span>NJ
          </span>
          <PhoneLink className="rounded-lg border border-accent px-3.5 py-2 text-sm font-bold text-accent transition-colors hover:bg-accent hover:text-white">
            <span className="dni-phone">{site.phone.display}</span>
          </PhoneLink>
        </div>
      </header>
      <main className="pb-20 sm:pb-0">{children}</main>
      <Footer minimal />
      <div className="h-16 sm:hidden" aria-hidden />
      <StickyCtaBar />
    </>
  );
}
