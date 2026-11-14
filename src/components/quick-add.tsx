"use client";

/** The requests people make most, one tap to add (or take back out of) a text box. */
export const QUICK_REQUESTS = [
  "keep all the pauses and ums",
  "play the whole clip, don’t cut it",
  "no slow motion",
  "all lowercase text",
  "center the captions",
  "no hyphens in the captions",
  "no emoji",
  "keep the text off faces",
];

export function QuickAdd({
  value,
  onChange,
  max,
  options = QUICK_REQUESTS,
}: {
  value: string;
  onChange: (next: string) => void;
  max: number;
  options?: string[];
}) {
  const has = (phrase: string) => value.toLowerCase().includes(phrase.toLowerCase());

  function toggle(phrase: string) {
    if (has(phrase)) {
      // Take it back out, with the separator it was added with.
      const re = new RegExp(`(^|[.\\n]\\s*)${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?`, "i");
      onChange(value.replace(re, "$1").replace(/^\s*\.\s*/, "").replace(/\s{2,}/g, " ").trim());
      return;
    }
    const base = value.trim();
    const next = base ? `${base.replace(/[.\s]*$/, "")}. ${phrase}.` : `${phrase}.`;
    if (next.length <= max) onChange(next);
  }

  return (
    <div className="flex flex-wrap gap-1.5" aria-label="quick requests">
      {options.map((phrase) => {
        const on = has(phrase);
        return (
          <button
            key={phrase}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(phrase)}
            className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition focus-visible:outline-2 focus-visible:outline-coral ${
              on ? "border-coral/60 bg-coral/15 text-foreground" : "border-white/10 bg-white/[0.03] text-muted hover:text-foreground"
            }`}
          >
            {on ? "✓ " : "+ "}
            {phrase}
          </button>
        );
      })}
    </div>
  );
}
