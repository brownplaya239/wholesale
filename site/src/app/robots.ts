import type { MetadataRoute } from "next";
import { site } from "@/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/lp/", "/thank-you", "/api/"],
      },
    ],
    sitemap: `${site.url}/sitemap.xml`,
  };
}
