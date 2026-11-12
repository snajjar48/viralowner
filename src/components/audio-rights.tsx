"use client";

/**
 * The notice users accept before using audio we don't license: the inspo's
 * sound, or an audio file they upload. Same promise either way.
 */
export function AudioRightsNotice({
  source,
  checked,
  onChange,
}: {
  source: "inspo" | "upload";
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-300/30 bg-amber-300/[0.06] p-3 text-sm">
      <p className="text-muted">
        <span className="font-medium text-foreground">heads up:</span>{" "}
        {source === "inspo"
          ? "the inspo’s sound usually belongs to someone else, like a song or another creator’s voice."
          : "unless you made this audio yourself, it probably belongs to someone else, like a song, a sound from another video or another person’s voice."}{" "}
        viralowner doesn’t own or license it. posting it can get your video muted, taken down or hit with a copyright
        claim. the safest way to use a trending sound is to pick “no music” and add the sound inside tiktok or
        instagram when you post.
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
