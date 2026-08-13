import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { counties } from "@/data/counties";
import { situations } from "@/data/situations";

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPaths = ["", "/how-it-works", "/about", "/reviews", "/privacy", "/terms"];
  const dataPaths = [
    ...counties.map((c) => `/${c.slug}`),
    ...situations.map((s) => `/${s.slug}`),
  ];
  return [...staticPaths, ...dataPaths].map((path) => ({
    url: `${site.url}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
