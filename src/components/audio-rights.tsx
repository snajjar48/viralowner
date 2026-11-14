"use client";

/**
 * The notice users accept before using audio we don't license: the inspo's
 * sound, or an audio file they upload. Same promise either way.
 */
export function AudioRightsNotice({
  checked,
  onChange,
}: {
  /** Where the audio comes from (the notice reads the same either way). */
  source: "inspo" | "upload";
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.06] p-3 text-sm">
      <p className="text-muted">
        <span className="font-medium text-foreground">heads up:</span> viralowner doesn’t own or license this audio.
        posting it can get your video muted, taken down or hit with a copyright claim.
      </p>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-coral"
        />
        <span>
          i own this audio or have permission to use it, and i take full responsibility for how i use it. i understand
          viralowner isn’t responsible for any claims about it.
        </span>
      </label>
    </div>
  );
}
