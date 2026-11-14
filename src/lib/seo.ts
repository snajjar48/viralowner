import type { Metadata } from "next";

/**
 * A public page's search appearance: title, description, canonical address and share card (title and description
 * repeated for Open Graph and X, which otherwise fall back to the home page's).
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  index = true,
}: {
  title: string;
  description: string;
  path: string;
  /** Use the title as is (no " | viralowner" after it). */
  absoluteTitle?: boolean;
  index?: boolean;
}): Metadata {
  const full = absoluteTitle ? title : `${title} | viralowner`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    // The featured image comes from the page's own opengraph-image.tsx (X uses it too).
    openGraph: { type: "website", siteName: "viralowner", url: path, title: full, description, locale: "en_US" },
    twitter: { card: "summary_large_image", title: full, description },
    robots: index
      ? { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } }
      : { index: false, follow: false },
  };
}
