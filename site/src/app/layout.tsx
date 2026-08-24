import type { Metadata, Viewport } from "next";
import Analytics from "@/components/Analytics";
import { site } from "@/config/site";
import "./globals.css";

const description =
  "Compare a direct cash offer for your NJ house with an estimate of what you could net by listing. Sell as-is, choose your timeline, and decide with no obligation.";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `Sell Your House Fast in New Jersey | ${site.name}`,
    template: `%s | ${site.name}`,
  },
  description,
  openGraph: {
    type: "website",
    siteName: site.name,
    url: site.url,
    title: `Sell Your House Fast in New Jersey | ${site.name}`,
    description,
    locale: "en_US",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: `${site.name} — one conversation, two numbers` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `Sell Your House Fast in New Jersey | ${site.name}`,
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
