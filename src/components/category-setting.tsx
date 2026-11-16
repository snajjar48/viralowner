"use client";

import { useState } from "react";
import { CategoryPicker } from "@/components/category-picker";
import { categoryLabel, type VideoCategory } from "@/lib/categories";
import { UploadError } from "@/lib/upload-client";

/**
 * The video's kind, shown in the flow with a way to change it (videos started before categories
 * existed are asked for one). Saved right away; the next version follows it.
 */
export function CategorySetting({ projectId, category }: { projectId: string; category: VideoCategory | null }) {
  const [value, setValue] = useState(category);
  const [open, setOpen] = useState(!category);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function save(next: VideoCategory) {
    const before = value;
    setValue(next);
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category: next }),
      });
      if (!res.ok) throw new UploadError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "couldn’t save that.");
      setOpen(false);
    } catch (e) {
      setValue(before);
      setError(e instanceof UploadError ? e.message : "couldn’t save that. please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      {open ? (
        <CategoryPicker
          value={value}
          onChange={save}
          disabled={saving}
          label={category ? "what kind of video is it?" : "what kind of video is it? it helps us match the vibe."}
        />
      ) : (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="text-muted">kind of video:</span> <span className="font-medium">{categoryLabel(value)}</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="cursor-pointer text-sm text-muted underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
          >
            change
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
    </div>
  );
}
