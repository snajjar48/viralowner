import type { Breakdown, InspoStyle, Shot } from "./processing/types";

/**
 * Fewer or more shots than the inspo has: the user's choice in the inspo step. Always rebuilt from
 * the inspo's own analysis (kept as `original`), so going up and down never loses anything.
 *  - fewer: the two neighboring shots that are shortest together become one (again and again);
 *  - more: the longest shot is split in two (again and again).
 * Every per-shot detail follows its shot: descriptions, filming tips, text and where it sits, speed,
 * motion and effects; the inspo's real cuts keep their transitions and sound effects stay where they
 * were heard.
 */

export const MIN_PIECE_S = 0.5;
export const MAX_SHOT_COUNT = 25;

export type WithOriginal = Breakdown & { original?: Breakdown };

/** The inspo's own analysis (before any change of shot count). */
export const originalOf = (b: WithOriginal): Breakdown => b.original ?? b;

export function shotCountRange(b: WithOriginal) {
  const o = originalOf(b);
  return { min: 1, max: Math.max(o.shotCount, Math.min(MAX_SHOT_COUNT, Math.floor(o.durationS / MIN_PIECE_S))), inspo: o.shotCount };
}

type Piece = { start: number; end: number };

export function reshape(input: WithOriginal, count: number): WithOriginal {
  const o = originalOf(input);
  const { min, max } = shotCountRange(input);
  const n = Math.min(max, Math.max(min, Math.round(count)));
  if (n === o.shotCount) return o; // back to the inspo's own shots
  const cutsAt = new Set(o.shots.slice(1).map((s) => s.startS.toFixed(2)));

  let pieces: Piece[] = o.shots.map((s) => ({ start: s.startS, end: s.startS + s.durationS }));
  while (pieces.length > n) {
    let best = 0;
    for (let i = 1; i < pieces.length - 1; i++) {
      if (pieces[i + 1].end - pieces[i].start < pieces[best + 1].end - pieces[best].start) best = i;
    }
    pieces.splice(best, 2, { start: pieces[best].start, end: pieces[best + 1].end });
  }
  while (pieces.length < n) {
    let longest = 0;
    pieces.forEach((p, i) => {
      if (p.end - p.start > pieces[longest].end - pieces[longest].start) longest = i;
    });
    const p = pieces[longest];
    if (p.end - p.start < 2 * MIN_PIECE_S) break;
    const mid = Math.round(((p.start + p.end) / 2) * 100) / 100;
    pieces.splice(longest, 1, { start: p.start, end: mid }, { start: mid, end: p.end });
  }
  pieces = pieces.map((p) => ({ start: Math.round(p.start * 100) / 100, end: Math.round(p.end * 100) / 100 }));

  // The inspo shot covering most of a piece is where its details come from.
  const overlap = (p: Piece, s: Shot) => Math.max(0, Math.min(p.end, s.startS + s.durationS) - Math.max(p.start, s.startS));
  const srcOf = (p: Piece) => o.shots.reduce((best, s, i) => (overlap(p, s) > overlap(p, o.shots[best]) ? i : best), 0);
  const covering = (p: Piece) => o.shots.filter((s) => overlap(p, s) > 0.05);
  const pieceAt = (t: number) => Math.max(0, pieces.findIndex((p) => t >= p.start - 1e-6 && t < p.end - 1e-6));

  const shots: Shot[] = pieces.map((p, i) => {
    const srcIndex = srcOf(p);
    const src = o.shots[srcIndex];
    const parts = covering(p);
    const unique = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x && x.trim() !== ""))];
    // One inspo shot split into several: "part 1 of 2"...
    const siblings = pieces.filter((q) => covering(q).length === 1 && srcOf(q) === srcIndex);
    const tip =
      siblings.length > 1 && parts.length === 1
        ? `${src.tip} (part ${siblings.indexOf(p) + 1} of ${siblings.length})`
        : unique(parts.map((s) => s.tip)).join("; then ") || src.tip;
    return {
      ...src,
      index: i,
      startS: p.start,
      durationS: Math.round((p.end - p.start) * 100) / 100,
      description: unique(parts.map((s) => s.description)).join(" then ") || src.description,
      tip,
      onScreenText: unique(parts.map((s) => s.onScreenText ?? null))[0] ?? null,
    };
  });

  let style: InspoStyle | undefined;
  if (o.style) {
    const st = o.style;
    const per = <T,>(xs: T[] | undefined) => (xs ? pieces.map((p) => xs[srcOf(p)]) : undefined);
    const transitions = pieces.slice(1).map((p) => {
      const at = o.shots.findIndex((s, j) => j > 0 && Math.abs(s.startS - p.start) < 0.03);
      return at > 0 && cutsAt.has(o.shots[at].startS.toFixed(2)) ? (st.transitions[at - 1] ?? "cut") : "cut";
    });
    // Sound effects stay at the moment they were heard.
    const sfx = (st.sfx ?? []).flatMap((x) => {
      const e = x as { anchor: "cut" | "shot"; index: number; name: string; frac?: number; offset?: number };
      const t =
        e.anchor === "cut"
          ? (o.shots[e.index + 1]?.startS ?? 0) + (e.offset ?? 0)
          : (o.shots[e.index]?.startS ?? 0) + (e.frac ?? 0) * (o.shots[e.index]?.durationS ?? 0);
      if (e.anchor === "cut") {
        const k = pieces.findIndex((p, j) => j > 0 && Math.abs(p.start - (o.shots[e.index + 1]?.startS ?? -9)) < 0.03);
        if (k > 0) return [{ ...e, index: k - 1 }];
      }
      const k = pieceAt(t);
      const p = pieces[k];
      return [{ ...e, anchor: "shot" as const, index: k, frac: Math.round(((t - p.start) / Math.max(0.01, p.end - p.start)) * 100) / 100, offset: undefined }];
    });
    style = {
      ...st,
      transitions,
      motions: per(st.motions) ?? [],
      textSpots: per(st.textSpots) ?? [],
      textLines: per(st.textLines),
      speeds: per(st.speeds),
      shotEffects: per(st.shotEffects),
      sfx: sfx as InspoStyle["sfx"],
    };
  }

  return {
    ...o,
    shots,
    shotCount: shots.length,
    avgShotS: Math.round((o.durationS / shots.length) * 10) / 10,
    style,
    original: o,
  };
}
