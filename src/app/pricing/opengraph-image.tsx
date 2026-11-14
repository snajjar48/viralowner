import { pageImage } from "@/lib/og";

// This page's featured image.
export const alt = "pricing: your first video is free.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return pageImage({ eyebrow: "pricing", title: "your first video is free." });
}
