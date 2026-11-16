import type { TextItem, TextStyle } from "./processing/types";

/**
 * Where and how the finished video draws a piece of on-screen text, worked out exactly as the
 * worker does (worker/app.py: text_look, item_style, fit_lines, block_size, items_timeline), so the
 * editor's preview matches the next version: same size, wrapping, place and look. Keep in step.
 * Sizes are pixels of the 1080×1920 frame.
 */

export const FRAME_W = 1080;
export const FRAME_H = 1920;
const SAFE = { top: 0.115, bottom: 0.75, left: 0.065, right: 0.85 };
const CENTER_X = 0.5;
const TOP_TEXT_Y = 0.2;
const TEXT_SIZES: Record<string, number> = { small: 0.028, medium: 0.038, large: 0.052, xl: 0.075 };

/**
 * Each font as the worker has it, measured from its font files (font_metrics): em = CSS font size
 * per size unit (libass sizes a font so its OS/2 win ascent + descent = the size), cap = capital
 * height per em.
 */
export const FONT_METRICS: Record<string, { em: number; cap: number }> = {
  clean_sans: { em: 0.72516, cap: 0.7 },
  semibold_sans: { em: 0.72516, cap: 0.7 },
  heavy_sans: { em: 0.74239, cap: 0.69 },
  condensed: { em: 0.5769, cap: 0.86 },
  tall_caps: { em: 0.76923, cap: 0.7 },
  serif: { em: 0.72939, cap: 0.67 },
  typewriter: { em: 0.75852, cap: 0.58 },
  marker: { em: 0.70089, cap: 0.77 },
  script: { em: 0.5168, cap: 0.89 },
  rounded: { em: 0.87489, cap: 0.7 },
};

export const DEFAULT_STYLE: TextStyle = {
  font: "clean_sans",
  color: "#FFFFFF",
  outline: "thick",
  outlineColor: "#000000",
  box: false,
  boxColor: "#FFFFFF",
  shadow: false,
  align: "center",
  size: "large",
  animation: "none",
};

/** Width in CSS pixels of `text` in this font at `px` (the real font, measured in the browser). */
export type Measure = (text: string, font: string, px: number) => number;

export function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return Number.isFinite(r + g + b) ? 0.2126 * r + 0.7152 * g + 0.0722 * b : 1;
}

type Style = TextStyle & { outline: string; boxColor?: string };

/** item_style: the video's text style with the item's own choices. */
export function itemStyle(style: Style, item: TextItem): Style {
  const st: Style = { ...style };
  if (item.font) st.font = item.font;
  if (item.color) st.color = item.color;
  if (item.align) st.align = item.align;
  if (item.animation) st.animation = item.animation;
  if (item.look === "box") Object.assign(st, { box: true, boxColor: style.box ? style.boxColor : undefined, outline: "none" });
  else if (item.look === "outline") Object.assign(st, { box: false, outline: st.outline && st.outline !== "none" ? st.outline : "thick" });
  else if (item.look === "plain") Object.assign(st, { box: false, outline: "none", shadow: true });
  if (st.box) {
    const textL = luminance(st.color ?? "#FFFFFF");
    let box = st.boxColor || "#FFFFFF";
    if (Math.abs(luminance(box) - textL) < 0.12) box = textL < 0.5 ? "#FFFFFF" : "#000000";
    st.boxColor = box;
  }
  return st;
}

export type Look = {
  font: string;
  size: number;
  color: string;
  /** The stroke (or, with a box, the box) color. */
  edge: string;
  box: boolean;
  /** Stroke width, or the box's padding. */
  outline: number;
  shadow: boolean;
};

const pyRound = (x: number) => {
  // Python rounds halves to even.
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
};

/** text_look */
export function textLook(st: Style, scale: number): Look {
  const font = FONT_METRICS[st.font] ? st.font : "clean_sans";
  const m = FONT_METRICS[font];
  const letter = st.letterHeight || TEXT_SIZES[st.size] || TEXT_SIZES.large;
  const size = pyRound(((letter * FRAME_H) / (m.cap * m.em)) * scale);
  const color = st.color || "#FFFFFF";
  if (st.box) {
    return { font, size, color, edge: st.boxColor || "#FFFFFF", box: true, outline: Math.max(6, pyRound(size * 0.2)), shadow: !!st.shadow };
  }
  const extra = { none: 0, thin: pyRound(size * 0.05), thick: pyRound(size * 0.09), caption: pyRound((size * 6) / 76) }[st.outline] ?? 0;
  const outline = Math.max(Math.max(3, pyRound(size * 0.07)), extra);
  const textLight = luminance(color) >= 0.5;
  let edge = st.outlineColor || "#000000";
  if (luminance(edge) >= 0.5 === textLight) edge = textLight ? "#000000" : "#FFFFFF";
  return { font, size, color, edge, box: false, outline, shadow: !!st.shadow };
}

const EMOJI = /\p{Extended_Pictographic}(‍\p{Extended_Pictographic}|️|\p{Emoji_Modifier})*|\p{Regional_Indicator}{2}/gu;

/** line_width: as a fraction of the frame's width (each emoji is a picture of a set size). */
function lineWidth(line: string, look: Look, size: number, measure: Measure) {
  const em = FONT_METRICS[look.font].em;
  let px = 0;
  let rest = line;
  for (const m of line.match(EMOJI) ?? []) {
    px += size * 0.86 * 1.08;
    rest = rest.replace(m, "");
  }
  if (rest) px += measure(rest, look.font, size * em);
  return px / FRAME_W;
}

/** fit_lines */
function fitLines(text: string, look: Look, avail: number, keepLines: boolean, measure: Measure): { lines: string[]; size: number } {
  let size = look.size;
  const wrap = (sz: number, src: string) => {
    const out: string[] = [];
    for (const para of src.split("\n")) {
      if (!para.trim()) {
        out.push(""); // a blank line left between lines: kept as space
        continue;
      }
      let cur = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const trial = `${cur} ${word}`.trim();
        if (cur && lineWidth(trial, look, sz, measure) > avail) {
          out.push(cur);
          cur = word;
        } else cur = trial;
      }
      if (cur) out.push(cur);
    }
    return out.length ? out : [src.trim()];
  };
  let lines: string[];
  if (keepLines) {
    // Exactly as typed, blank lines too (space between lines).
    lines = text.trim().split("\n").map((l) => l.trim());
  } else {
    const most = Math.max(3, text.split("\n").filter((p) => p.trim()).length);
    lines = wrap(size, text);
    const floor = pyRound(size * 0.6);
    while (lines.length > most && size > floor) {
      size = Math.max(floor, pyRound(size * 0.93));
      lines = wrap(size, text);
    }
  }
  const widest = Math.max(...lines.map((l) => lineWidth(l, look, size, measure)));
  if (widest > avail) size = Math.max(pyRound(size * 0.5), Math.floor((size * avail) / widest));
  if (keepLines && Math.max(...lines.map((l) => lineWidth(l, look, size, measure))) > avail) lines = wrap(size, lines.join("\n"));
  return { lines, size };
}

const defaultX = (align: string) => ({ left: SAFE.left + 0.01, right: SAFE.right - 0.01 })[align as "left"] ?? CENTER_X;

function availableWidth(align: string, x: number) {
  if (align === "left") return SAFE.right - x;
  if (align === "right") return x - SAFE.left;
  return 2 * Math.min(x - SAFE.left, SAFE.right - x);
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export type Placed = {
  lines: string[];
  /** libass size (px of the frame, also the line spacing); the CSS font size is size × FONT_METRICS[font].em. */
  size: number;
  x: number;
  y: number;
  align: "left" | "center" | "right";
  look: Look;
};

/** items_timeline: one text item, placed and sized as the finished video draws it. */
export function placeItem(
  item: TextItem,
  ctx: { style?: TextStyle | null; textScale?: number | null; position?: string | null },
  measure: Measure,
): Placed {
  const st = itemStyle({ ...DEFAULT_STYLE, ...(ctx.style ?? {}) } as Style, item);
  const look = textLook(st, (ctx.textScale ?? 1) * (item.size ?? 1));
  const align = (st.align as Placed["align"]) || "center";
  let x = item.x ?? defaultX(align);
  if (align === "center" && item.x == null) x = CENTER_X;
  const { lines, size } = fitLines(item.text, look, availableWidth(align, x), item.text.includes("\n"), measure);
  const pad = look.box ? 2 * look.outline : look.outline;
  const w = Math.max(...lines.map((l) => lineWidth(l, look, size, measure))) + (2 * pad) / FRAME_W;
  const h = (lines.length * size * 1.2 + 2 * pad) / FRAME_H;
  let y = item.y ?? ({ top: TOP_TEXT_Y + h / 2, middle: 0.45 } as Record<string, number>)[ctx.position ?? ""] ?? 0.32;
  if (item.y == null && item.x == null) {
    const [lo, hi] =
      align === "left" ? [SAFE.left, SAFE.right - w] : align === "right" ? [SAFE.left + w, SAFE.right] : [SAFE.left + w / 2, SAFE.right - w / 2];
    x = lo <= hi ? Math.min(Math.max(x, lo), hi) : defaultX(align);
    if (align === "center") x = CENTER_X;
    const [ly, hy] = [SAFE.top + h / 2, SAFE.bottom - h / 2];
    y = ly <= hy ? Math.min(Math.max(y, ly), hy) : (SAFE.top + SAFE.bottom) / 2;
    x = r2(x);
    y = r2(y);
  } else {
    y = Math.min(Math.max(y, h / 2 + 0.005), 1 - h / 2 - 0.005);
  }
  return { lines, size, x, y, align, look };
}
