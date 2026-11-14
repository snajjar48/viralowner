import type { MetadataRoute } from "next";
import { SHOWCASE } from "@/content/showcase";

const BASE = "https://www.viralowner.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/what-is-viralowner", "/why-viralowner", "/pricing", ...(SHOWCASE.length ? ["/made-with-viralowner"] : [])].map((path) => ({
    url: `${BASE}${path}`,
    changeFrequency: "monthly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
