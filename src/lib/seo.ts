import type { Metadata } from "next";

const SHARE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "viralowner: skip the editing, keep the views" };

/**
 * A public page's title, description, canonical address and share card (title and description
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
    // The share picture (src/app/opengraph-image.tsx) has to be named again once a page sets its own card.
    openGraph: { type: "website", siteName: "viralowner", url: path, title: full, description, locale: "en_US", images: [SHARE_IMAGE] },
    twitter: { card: "summary_large_image", title: full, description, images: [SHARE_IMAGE] },
    ...(index ? {} : { robots: { index: false, follow: false } }),
  };
}
