"use client";

import Link from "next/link";
import { useState } from "react";
import { BusinessForm, EMPTY_PROFILE } from "@/components/business-form";
import { XIcon } from "@/components/icons";

/** Asked once, before the first video: the business, so every video gets its names and products right. */
export function BusinessPrompt() {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-coral/30 bg-coral/[0.05] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">tell us about you and your business (once)</p>
          <p className="text-sm text-muted">
            your business name and the words you use, so every video spells your products right the first time.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHidden(true)}
          aria-label="not now"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
        >
          <XIcon className="size-4" />
        </button>
      </div>
      {open ? (
        <>
          <BusinessForm
            initial={EMPTY_PROFILE}
            short
            onSaved={() => setTimeout(() => setHidden(true), 900)}
            submitLabel="save my profile"
          />
          <p className="text-xs text-muted">
            add more any time (your tone, things to always say, what to avoid) under{" "}
            <Link href="/profile" className="underline underline-offset-4 hover:text-foreground">
              your profile
            </Link>
            .
          </p>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-10 w-fit cursor-pointer rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
        >
          add my details
        </button>
      )}
    </section>
  );
}
