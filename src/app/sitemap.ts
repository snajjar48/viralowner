import type { MetadataRoute } from "next";
import { SHOWCASE } from "@/content/showcase";
import { PRICING_PAGE_PUBLIC } from "@/lib/plan-format";

const BASE = "https://www.viralowner.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/what-is-viralowner", "/why-viralowner", ...(PRICING_PAGE_PUBLIC ? ["/pricing"] : []), ...(SHOWCASE.length ? ["/made-with-viralowner"] : [])].map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
