import { markImage } from "@/lib/og";

// The icon phones use for the site (home screen, bookmarks).
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return markImage(180);
}
