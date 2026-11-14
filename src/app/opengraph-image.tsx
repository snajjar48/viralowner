import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The picture shown when any viralowner page is shared (iMessage, Instagram DMs, Facebook, X, Slack...).
export const alt = "viralowner: skip the editing, keep the views";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Lexend (the site's font), bold, from Google Fonts. Null if it can't be fetched: the default font is used. */
async function lexendBold(): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch("https://fonts.googleapis.com/css2?family=Lexend:wght@600&display=swap")).text();
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function OpenGraphImage() {
  const [logo, font] = await Promise.all([readFile(join(process.cwd(), "public/logo.svg"), "base64"), lexendBold()]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0B0B0F",
          backgroundImage:
            "radial-gradient(circle at 12% 18%, rgba(105,27,234,0.55), transparent 45%), radial-gradient(circle at 92% 88%, rgba(246,49,101,0.45), transparent 45%)",
          color: "#F5F5F7",
          fontFamily: font ? "Lexend" : "sans-serif",
        }}
      >
        <img src={`data:image/svg+xml;base64,${logo}`} alt="" width={244} height={70} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 92, fontWeight: 600, lineHeight: 1.02, letterSpacing: -3 }}>
            <span>skip the editing,</span>
            <span
              style={{
                backgroundImage: "linear-gradient(90deg, #8B4BFF, #F63165)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              keep the views.
            </span>
          </div>
          <span style={{ fontSize: 34, color: "#A1A1AA", maxWidth: 940 }}>
            your own clips, edited like the videos that went viral. made for business owners and creators.
          </span>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "Lexend", data: font, weight: 600, style: "normal" }] : undefined },
  );
}
