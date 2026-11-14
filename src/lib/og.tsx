import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// The featured images: what Google, iMessage, Instagram, Facebook, X and Slack show for a page.

export const OG_SIZE = { width: 1200, height: 630 };

const BG = {
  background: "#0B0B0F",
  backgroundImage:
    "radial-gradient(circle at 12% 18%, rgba(105,27,234,0.55), transparent 45%), radial-gradient(circle at 92% 88%, rgba(246,49,101,0.45), transparent 45%)",
};

/** Lexend (the site's font) from Google Fonts. Null if it can't be fetched: the default font is used. */
async function lexend(weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Lexend:wght@${weight}&display=swap`)).text();
    const url = /src: url\((.+?)\) format\('(?:opentype|truetype)'\)/.exec(css)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

const svg = (file: string) => readFile(join(process.cwd(), file), "base64").then((b) => `data:image/svg+xml;base64,${b}`);

/** The home page's image: just the logo. */
export async function logoImage() {
  const logo = await svg("public/logo.svg");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", ...BG }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- drawn into a PNG */}
        <img src={logo} width={840} height={241} />
      </div>
    ),
    OG_SIZE,
  );
}

/** Another page's image: the logo, what the page is, and its headline. */
export async function pageImage({ eyebrow, title }: { eyebrow: string; title: string }) {
  const [logo, semibold, regular] = await Promise.all([svg("public/logo.svg"), lexend(600), lexend(400)]);
  const fonts = [
    ...(semibold ? [{ name: "Lexend", data: semibold, weight: 600 as const, style: "normal" as const }] : []),
    ...(regular ? [{ name: "Lexend", data: regular, weight: 400 as const, style: "normal" as const }] : []),
  ];
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "70px 80px",
          color: "#F5F5F7",
          fontFamily: fonts.length ? "Lexend" : "sans-serif",
          ...BG,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- drawn into a PNG */}
        <img src={logo} width={260} height={75} />
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <span
            style={{
              fontSize: 34,
              fontWeight: 400,
              backgroundImage: "linear-gradient(90deg, #8B4BFF, #F63165)",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            {eyebrow}
          </span>
          <span style={{ fontSize: title.length > 48 ? 70 : 84, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2.5, maxWidth: 1040 }}>
            {title}
          </span>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fonts.length ? fonts : undefined },
  );
}

/** The square mark (Apple touch icon and the logo search engines show for the company). */
export async function markImage(px: number) {
  const mark = await svg("src/app/icon.svg");
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0B0B0F" }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- drawn into a PNG */}
        <img src={mark} width={Math.round(px * 0.72)} height={Math.round(px * 0.72)} />
      </div>
    ),
    { width: px, height: px },
  );
}
