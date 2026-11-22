import { Anton, Archivo_Black, Bebas_Neue, Courier_Prime, DM_Serif_Display, Lilita_One, Montserrat, Pacifico, Permanent_Marker, TikTok_Sans } from "next/font/google";

/**
 * The fonts the finished video draws text with (FONTS in worker/app.py, the same Google font
 * files), so the editor's text preview looks like the next version. Loaded only on this page and
 * only when a preview needs them (no preload).
 */
// (next/font needs each call's options written out.)
const montserrat = Montserrat({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: ["600", "700"] });
const archivo = Archivo_Black({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "400" });
const anton = Anton({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "400" });
const bebas = Bebas_Neue({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "400" });
const dmSerif = DM_Serif_Display({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "400" });
const courier = Courier_Prime({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "700" });
const marker = Permanent_Marker({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "400" });
const pacifico = Pacifico({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "400" });
const lilita = Lilita_One({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "400" });
const social = TikTok_Sans({ subsets: ["latin"], display: "swap", preload: false, adjustFontFallback: false, weight: "600" });

export const VIDEO_FONTS: Record<string, { family: string; weight: number }> = {
  clean_sans: { family: montserrat.style.fontFamily, weight: 700 },
  semibold_sans: { family: montserrat.style.fontFamily, weight: 600 },
  heavy_sans: { family: archivo.style.fontFamily, weight: 400 },
  condensed: { family: anton.style.fontFamily, weight: 400 },
  tall_caps: { family: bebas.style.fontFamily, weight: 400 },
  serif: { family: dmSerif.style.fontFamily, weight: 400 },
  typewriter: { family: courier.style.fontFamily, weight: 700 },
  marker: { family: marker.style.fontFamily, weight: 400 },
  script: { family: pacifico.style.fontFamily, weight: 400 },
  rounded: { family: lilita.style.fontFamily, weight: 400 },
  social_sans: { family: social.style.fontFamily, weight: 600 },
};

export const videoFont = (key: string) => VIDEO_FONTS[key] ?? VIDEO_FONTS.clean_sans;
