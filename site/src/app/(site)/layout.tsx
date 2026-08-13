import Footer from "@/components/Footer";
import Header from "@/components/Header";
import StickyCtaBar from "@/components/StickyCtaBar";

/** Main-site chrome: nav header, full footer, mobile sticky CTA bar. */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Header />
      {/* pb keeps the sticky mobile bar from covering the footer facts */}
      <main className="pb-20 sm:pb-0">{children}</main>
      <Footer />
      <div className="h-16 sm:hidden" aria-hidden />
      <StickyCtaBar />
    </>
  );
}
