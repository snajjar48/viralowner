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
        {source === "inspo" ? "this sound usually belongs to someone else." : "this audio may belong to someone else."} viralowner
        doesn’t own or license it, and it could get your video muted or taken down. safest: pick “no music” and add the
        sound in tiktok or instagram.
      </p>
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-coral"
        />
        <span>
          i own this audio or have permission to use it, and i’m responsible for how i use it.
        </span>
      </label>
    </div>
  );
}
