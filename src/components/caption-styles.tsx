"use client";

import { CAPTION_STYLES, TEXT_STYLES, type CaptionStyleId, type TextStyleId } from "@/lib/video-options";

/** A tiny visual sample of each caption style. */
function Sample({ id }: { id: CaptionStyleId }) {
  switch (id) {
    case "bold-pop":
      return (
        <span className="text-lg leading-tight font-black tracking-tight text-white uppercase [text-shadow:0_2px_0_#000,0_0_12px_rgba(0,0,0,0.6)]">
          this <span className="text-[#ffd84d]">changed</span>
        </span>
      );
    case "clean":
      return <span className="text-xs font-semibold text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.8)]">this changed everything for me</span>;
    case "outline":
      return (
        <span className="text-sm font-semibold text-white [-webkit-text-stroke:3px_#000] [paint-order:stroke_fill]">
          this changed everything
        </span>
      );
    case "bold-outline":
      return (
        <span className="text-base leading-tight font-extrabold text-white [-webkit-text-stroke:5px_#000] [paint-order:stroke_fill]">
          this changed everything
        </span>
      );
    case "boxed":
      return <span className="rounded bg-white px-1.5 py-0.5 text-xs font-semibold text-black">this changed everything</span>;
    case "karaoke":
      return (
        <span className="text-sm font-bold text-white/60">
          this <span className="text-white">changed</span> everything
        </span>
      );
  }
}

export function CaptionStylePicker({
  value,
  onChange,
  disabled,
}: {
  value: CaptionStyleId;
  onChange: (id: CaptionStyleId) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label="caption style" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {CAPTION_STYLES.map((s) => {
        const checked = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={`flex cursor-pointer flex-col gap-2 rounded-xl border p-2 text-left transition focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40 ${
              checked ? "border-coral/70 bg-coral/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"
            }`}
          >
            <span className="flex aspect-[4/3] items-end justify-center rounded-lg bg-linear-to-b from-[#3a2a55] via-[#2a1f3d] to-[#1a1424] p-2 pb-3 text-center">
              <Sample id={s.id} />
            </span>
            <span className="px-1 text-sm font-medium">{s.name}</span>
            <span className="px-1 text-xs text-muted">{s.description}</span>
          </button>
        );
      })}
    </div>
  );
}

const stroke = (px: number, color = "#000") => ({ WebkitTextStroke: `${px}px ${color}`, paintOrder: "stroke fill" });

/** A tiny sample of each on-screen text look. */
function TextSample({ id }: { id: TextStyleId }) {
  const base = "text-[13px] leading-tight";
  switch (id) {
    case "auto":
      return <span className={`${base} font-semibold text-white/80`}>Aa</span>;
    case "classic":
      return <span className={`${base} font-extrabold text-white`} style={stroke(2)}>pov: you</span>;
    case "bold-pop":
      return <span className={`${base} font-black text-[#FFD84D]`} style={stroke(3)}>pov: you</span>;
    case "boxed":
      return <span className={`${base} rounded-sm bg-white px-1.5 py-0.5 font-semibold text-black`}>pov: you</span>;
    case "dark-box":
      return <span className={`${base} rounded-sm bg-black px-1.5 py-0.5 font-semibold text-white`}>pov: you</span>;
    case "headline":
      return (
        <span className={`${base} text-white`} style={{ ...stroke(2), fontFamily: "Impact, 'Arial Narrow Bold', sans-serif" }}>
          pov: you
        </span>
      );
    case "handwritten":
      return (
        <span className={`${base} text-white uppercase`} style={{ ...stroke(2), fontFamily: "'Marker Felt', 'Permanent Marker', cursive" }}>
          pov: you
        </span>
      );
    case "neon":
      return (
        <span className={`${base} font-extrabold text-[#FF5FD2]`} style={{ ...stroke(2, "#fff"), fontFamily: "ui-rounded, 'Arial Rounded MT Bold', sans-serif" }}>
          pov: you
        </span>
      );
  }
}

export function TextStylePicker({
  value,
  onChange,
  autoName,
  disabled,
}: {
  value: TextStyleId;
  onChange: (id: TextStyleId) => void;
  /** What "auto" means here: "like inspo", or "we pick" (start from scratch). */
  autoName: string;
  disabled?: boolean;
}) {
  const choices: { id: TextStyleId; name: string }[] = [{ id: "auto", name: autoName }, ...TEXT_STYLES];
  return (
    <div role="radiogroup" aria-label="text style" className="grid grid-cols-4 gap-1.5">
      {choices.map((s) => {
        const checked = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChange(s.id)}
            className={`flex cursor-pointer flex-col gap-1.5 rounded-xl border p-1.5 text-left transition focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40 ${
              checked ? "border-coral/70 bg-coral/10" : "border-white/10 bg-white/[0.03] hover:border-white/25"
            }`}
          >
            <span className="flex aspect-[4/3] items-center justify-center rounded-lg bg-linear-to-b from-[#3a2a55] via-[#2a1f3d] to-[#1a1424] p-1 text-center">
              <TextSample id={s.id} />
            </span>
            <span className="truncate px-0.5 text-xs font-medium">{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** An accessible on/off switch. */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral ${
        checked ? "bg-linear-to-r from-violet to-coral" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${checked ? "left-6" : "left-1"}`}
      />
    </button>
  );
}
