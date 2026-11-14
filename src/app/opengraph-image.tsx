import { logoImage } from "@/lib/og";

// The home page's featured image: the logo.
export const alt = "viralowner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return logoImage();
}
