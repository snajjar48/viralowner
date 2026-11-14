import { markImage } from "@/lib/og";

/** The company logo as a square PNG (search engines show it next to the brand). */
export function GET() {
  return markImage(512);
}
