import { pageImage } from "@/lib/og";

// This page's featured image.
export const alt = "made with viralowner: viral videos, made from people’s own clips.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return pageImage({ eyebrow: "made with viralowner", title: "viral videos, made from people’s own clips." });
}
