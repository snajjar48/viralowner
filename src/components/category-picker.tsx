"use client";

import { VIDEO_CATEGORIES, type VideoCategory } from "@/lib/categories";

/** What kind of video this is: the vibe the editor goes for (each kind has its own playbook). */
export function CategoryPicker({
  value,
  onChange,
  disabled,
  label = "what kind of video is it?",
}: {
  value: VideoCategory | null;
  onChange: (c: VideoCategory) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div role="radiogroup" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {VIDEO_CATEGORIES.map((c) => {
          const on = value === c.id;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(c.id)}
              className={`flex cursor-pointer flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-50 ${
                on ? "border-coral/70 bg-coral/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/25"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <span
                  aria-hidden="true"
                  className={`size-3.5 shrink-0 rounded-full border-2 ${on ? "border-coral bg-coral" : "border-white/30"}`}
                />
                {c.label}
              </span>
              <span className="pl-5.5 text-xs text-muted">{c.blurb}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
