"use client";

import { useState } from "react";
import { CheckIcon } from "./icons";

/** Copies text to the clipboard and says so. */
export function CopyButton({ text, label, display = "copy" }: { text: string; label: string; display?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-medium transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral"
    >
      {state === "copied" ? (
        <>
          <CheckIcon className="size-3.5 text-coral" /> copied
        </>
      ) : state === "failed" ? (
        "press and hold to copy"
      ) : (
        display
      )}
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "copied to clipboard" : ""}
      </span>
    </button>
  );
}
