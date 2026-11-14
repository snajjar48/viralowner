/** Structured data (schema.org JSON-LD) that tells search engines what a page is. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // JSON.stringify can't break out of the script tag once "<" is escaped.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}

export const SITE_URL = "https://www.viralowner.com";

/** Who we are and the site itself (home page). */
export const ORGANIZATION = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "viralowner",
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
      email: "hello@viralowner.com",
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: "viralowner",
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      name: "viralowner",
      url: SITE_URL,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Web",
      description:
        "a video editor for business owners and creators: send a video that went viral and your own clips, and get yours back edited the same way, captioned and ready to post on TikTok, Reels and Shorts.",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

/** Breadcrumbs for a page one level below home. */
export function breadcrumbs(name: string, path: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
    ],
  };
}
