import type { Metadata, Viewport } from "next";
import Analytics from "@/components/Analytics";
import { site } from "@/config/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `Sell Your House Fast in New Jersey | ${site.name}`,
    template: `%s | ${site.name}`,
  },
  description:
    "Fair cash offer on your NJ house within 24 hours from a licensed local agent. No fees, no repairs, no obligation — and if listing would net you more, we'll tell you honestly.",
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
