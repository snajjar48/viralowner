import type { Breakdown, RenderPlan, TextItem } from "./processing/types";

/**
 * The on-screen text of a version made before text was saved piece by piece: each shot's text over
 * that shot (neighbors with the same words joined), at the height it was placed or the inspo had it.
 * Close to what's on screen; the next version is drawn from exactly these pieces.
 */
export function textItemsFromShots(plan: RenderPlan | null | undefined, breakdown: Breakdown | null): TextItem[] | null {
  if (!plan?.texts?.length) return plan ? [] : null;
  const removed = new Set(plan.removedShots ?? []);
  let lengths: number[] | null = null;
  let spots: (number | null)[] = [];
  if (plan.jumpcut?.length) {
    lengths = plan.jumpcut.map((c) => c.endS - c.startS);
  } else if (breakdown) {
    const kept = breakdown.shots.filter((s) => !removed.has(s.index));
    lengths = plan.shotLengths?.length === kept.length ? plan.shotLengths : kept.map((s) => s.durationS);
    spots = kept.map((s) => breakdown.style?.textSpots?.[s.index]?.[1] ?? null);
  } else {
    // "Start from scratch": each shot's trim.
    const ls = plan.shots.map((s) => (s.trimStartS !== null && s.trimEndS !== null ? s.trimEndS - s.trimStartS : NaN));
    lengths = ls.every((x) => x > 0) ? ls : null;
  }
  if (!lengths || lengths.length !== plan.texts.length) {
    // The shots' lengths don't line up with the text (older versions): each kept shot's trim instead.
    const kept = plan.shots.filter((s) => !removed.has(s.shotIndex));
    const ls = kept.map((s) => (s.trimStartS !== null && s.trimEndS !== null ? s.trimEndS - s.trimStartS : NaN));
    if (ls.length !== plan.texts.length || !ls.every((x) => x > 0)) return null;
    lengths = ls;
  }
  const items: TextItem[] = [];
  let t = 0;
  plan.texts.forEach((raw, i) => {
    const text = (raw ?? "").trim();
    const start = t;
    t += lengths![i];
    if (!text) return;
    const y = plan.textYs?.[i] ?? spots[i] ?? null;
    const last = items.at(-1);
    if (last && last.text === text && Math.abs(last.end - start) < 0.02) {
      last.end = Math.round(t * 100) / 100;
      return;
    }
    items.push({ text, start: Math.round(start * 100) / 100, end: Math.round(t * 100) / 100, y });
  });
  return items;
}
