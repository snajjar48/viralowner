"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { SparkleIcon, XIcon } from "@/components/icons";

// Which tips this device has closed. Only a convenience: if the browser can't remember, the tip shows again.
const key = (id: string) => `viralowner:tip:${id}`;
const EVENT = "viralowner:tip";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function seen(id: string) {
  try {
    return window.localStorage.getItem(key(id)) === "1";
  } catch {
    return false;
  }
}

/** A short tip shown the first time someone reaches a step, until they close it. */
export function FirstTimeTip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  // Hidden on the server and until the browser says it hasn't been closed (no flash for people who closed it).
  const hidden = useSyncExternalStore(subscribe, () => seen(id), () => true);
  if (hidden) return null;

  function close() {
    try {
      window.localStorage.setItem(key(id), "1");
    } catch {
      // can't remember it: just hide it for now
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <aside className="flex items-start gap-3 rounded-2xl border border-violet/40 bg-violet/[0.08] p-4" aria-label="tip">
      <SparkleIcon className="mt-0.5 size-4 shrink-0 text-coral" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
        <p className="font-medium">{title}</p>
        <div className="flex flex-col gap-1.5 text-pretty text-muted">{children}</div>
        <button
          type="button"
          onClick={close}
          className="mt-1 w-fit cursor-pointer text-sm font-medium text-foreground underline underline-offset-4 hover:text-coral"
        >
          got it
        </button>
      </div>
      <button
        type="button"
        onClick={close}
        aria-label="close tip"
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
      >
        <XIcon className="size-4" />
      </button>
    </aside>
  );
}
