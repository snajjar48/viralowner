import type { MetadataRoute } from "next";

/** Search engines see the public pages; the app itself stays out of results. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/projects/", "/start"] },
    sitemap: "https://www.viralowner.com/sitemap.xml",
  };
}
