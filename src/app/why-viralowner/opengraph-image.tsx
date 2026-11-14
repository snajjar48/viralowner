import { pageImage } from "@/lib/og";

// This page's featured image.
export const alt = "why viralowner: posting every day shouldn’t mean editing every night.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return pageImage({ eyebrow: "why viralowner", title: "posting every day shouldn’t mean editing every night." });
}
