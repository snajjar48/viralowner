import { pageImage } from "@/lib/og";

// This page's featured image.
export const alt = "how it works: a video editor that works like a person, in minutes.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return pageImage({ eyebrow: "how it works", title: "a video editor that works like a person, in minutes." });
}
