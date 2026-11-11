"use client";

import { useId, type ReactNode } from "react";
import { CheckIcon } from "./icons";

/** A required "i confirm…" checkbox with a large, touch-friendly target. */
export function ConsentCheckbox({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-white/20 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-coral"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        required
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border transition ${
          checked ? "border-transparent bg-linear-to-r from-violet to-coral text-white" : "border-white/30"
        }`}
      >
        {checked && <CheckIcon className="size-3.5" />}
      </span>
      <span className="text-sm text-foreground/90">{children}</span>
    </label>
  );
}
