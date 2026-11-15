import { EMOJI_KIT_CELL as CELL, EMOJI_KIT_COLS as COLS, EMOJI_KIT_PER_SHEET as PER_SHEET, KIT_EMOJIS, KIT_FLAGS } from "./emoji-kit";

/**
 * Drawing the emoji kit in the browser, with this device's own emoji font (see
 * components/emoji-kit-sync.tsx). No React, so it can be tested on its own in a browser.
 */

const FONT = '"Apple Color Emoji", "Segoe UI Emoji", sans-serif'; // otherwise the device's own default (Android, Samsung, …)
// Drawn in this color, so a character the device has no color emoji for (it falls back to
// plain text, in this color) can be told apart from a real emoji, which ignores it.
const PROBE = "#ff00ff";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  return ctx ? { c, ctx } : null;
}

let scratch: { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;
const PAD = CELL; // room around the emoji on the scratch canvas, for glyphs that reach past their measured size

/**
 * Draws `emoji` centered in the square at (x, y), as big as fits; false if this device can't draw
 * it as one color emoji. It's drawn on a bigger scratch canvas first and its real edges found from
 * the pixels (some glyphs reach past what the browser measures), then fitted into the square.
 */
function draw(ctx: CanvasRenderingContext2D, emoji: string, x: number, y: number, isFlag: boolean): boolean {
  scratch ??= canvas(CELL + 2 * PAD, CELL + 2 * PAD);
  if (!scratch) return false;
  const s = scratch.ctx;
  const side = CELL + 2 * PAD;
  s.clearRect(0, 0, side, side);
  s.fillStyle = PROBE;
  // Big enough that the emoji fills its square (it's fitted down to it below, never enlarged).
  const size = CELL;
  s.font = `${size}px ${FONT}`;
  // One emoji takes about one character's width; a combination this device can't draw falls apart
  // into two or more side by side.
  if (s.measureText(emoji).width > size * 1.7) return false;
  s.textAlign = "center";
  s.textBaseline = "middle";
  s.fillText(emoji, side / 2, side / 2);
  const px = s.getImageData(0, 0, side, side).data;
  // The emoji's real edges, and what it's made of.
  let [x0, y0, x1, y1] = [side, side, -1, -1];
  let solid = 0;
  let probe = 0;
  let colorful = 0;
  for (let yy = 0; yy < side; yy += 2) {
    for (let xx = 0; xx < side; xx += 2) {
      const i = (yy * side + xx) * 4;
      if (px[i + 3] < 24) continue;
      if (xx < x0) x0 = xx;
      if (yy < y0) y0 = yy;
      if (xx > x1) x1 = xx;
      if (yy > y1) y1 = yy;
      if (px[i + 3] < 128) continue;
      solid++;
      const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
      if (r > 200 && g < 90 && b > 200) probe++;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colorful++;
    }
  }
  if (x1 < 0 || solid < 40) return false;
  x0 = Math.max(0, x0 - 2);
  y0 = Math.max(0, y0 - 2);
  const w = Math.min(side, x1 + 3) - x0;
  const h = Math.min(side, y1 + 3) - y0;
  // Plain-text fallback (the probe color), e.g. letters instead of a flag.
  if (probe > solid * 0.25) return false;
  // (Some flags are mostly white, like Japan's: a little color is enough.)
  if (isFlag && colorful < solid * 0.03) return false;
  const k = Math.min(1, (CELL * 0.94) / Math.max(w, h));
  ctx.drawImage(scratch.c, x0, y0, w, h, x + (CELL - w * k) / 2, y + (CELL - h * k) / 2, w * k, h * k);
  return true;
}

/** How this device draws emoji, as a short id (null: no color emoji here). */
export function fingerprint(): string | null {
  const k = canvas(CELL * 3, CELL);
  if (!k) return null;
  k.ctx.fillStyle = PROBE;
  const drawn = ["😀", "🔥", "🇺🇸"].map((e, i) => draw(k.ctx, e, i * CELL, 0, i === 2));
  if (!drawn[0] || !drawn[1]) return null;
  const px = k.ctx.getImageData(0, 0, CELL * 3, CELL).data;
  let hash = 2166136261;
  for (let i = 0; i < px.length; i += 28) {
    hash ^= px[i] >> 3;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36) + (drawn[2] ? "f" : "n");
}

export function toBlob(c: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => c.toBlob(resolve, type, 0.92));
}

/** The kit's sheets: emojis first (most used first), then flags; each only the ones this device drew. */
export async function drawSheets(): Promise<{ emojis: string[]; c: HTMLCanvasElement }[]> {
  const sheets: { emojis: string[]; c: HTMLCanvasElement }[] = [];
  const todo = [...KIT_EMOJIS.map((e) => [e, false] as const), ...KIT_FLAGS.map((e) => [e, true] as const)];
  let i = 0;
  while (i < todo.length) {
    const k = canvas(COLS * CELL, Math.ceil(PER_SHEET / COLS) * CELL);
    if (!k) return sheets;
    k.ctx.fillStyle = PROBE;
    const emojis: string[] = [];
    while (i < todo.length && emojis.length < PER_SHEET) {
      const [e, isFlag] = todo[i++];
      const n = emojis.length;
      if (draw(k.ctx, e, (n % COLS) * CELL, Math.floor(n / COLS) * CELL, isFlag)) emojis.push(e);
    }
    if (!emojis.length) continue;
    // Only as tall as it needs to be.
    const rows = Math.ceil(emojis.length / COLS);
    const out = canvas(COLS * CELL, rows * CELL);
    if (!out) return sheets;
    out.ctx.drawImage(k.c, 0, 0);
    sheets.push({ emojis, c: out.c });
    // Let the page breathe between sheets.
    await new Promise((r) => setTimeout(r, 50));
  }
  return sheets;
}
