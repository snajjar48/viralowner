import type { MetadataRoute } from "next";

const BASE = "https://www.viralowner.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/what-is-viralowner", "/why-viralowner", "/pricing"].map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
