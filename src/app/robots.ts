import type { MetadataRoute } from "next";

/** Search engines see the public pages; the app stays out. (/start isn't blocked here: it says noindex itself, which crawlers must be allowed to read.) */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/projects/", "/new", "/scratch", "/profile", "/plans", "/unlock"] },
    sitemap: "https://www.viralowner.com/sitemap.xml",
  };
}
