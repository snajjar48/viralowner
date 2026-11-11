"use client";

import { useId, useState, type ReactNode } from "react";
import { UploadIcon } from "./icons";

/**
 * Tap to pick (phones open the camera roll), or drag and drop on desktop.
 * Keyboard: the hidden input is focusable; the zone shows its focus ring.
 */
export function DropZone({
  accept,
  multiple = false,
  disabled = false,
  onFiles,
  title,
  hint,
  icon,
  compact = false,
}: {
  accept: string;
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  title: string;
  hint?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  const id = useId();
  const [dragging, setDragging] = useState(false);

  return (
    <label
      htmlFor={id}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={`group relative flex w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed text-center transition focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-coral ${
        compact ? "px-4 py-6" : "px-6 py-12 sm:py-16"
      } ${
        dragging
          ? "border-coral bg-coral/10"
          : "border-white/20 bg-white/[0.03] hover:border-white/40 hover:bg-white/[0.06]"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-linear-to-r from-violet to-coral text-white shadow-[0_10px_30px_-8px_rgba(246,49,101,0.7)]">
        {icon ?? <UploadIcon className="size-5" />}
      </span>
      <span className="text-base font-medium">{title}</span>
      {hint && <span className="max-w-xs text-sm text-muted">{hint}</span>}
      <input
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        // Reset when the picker opens (so the same file can be picked again),
        // never right after picking: iOS Safari drops access to a Photos
        // video once its input is cleared, and the upload dies instantly.
        onClick={(e) => {
          e.currentTarget.value = "";
        }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}
