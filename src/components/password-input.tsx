"use client";

import { useState, type InputHTMLAttributes } from "react";
import { inputClass } from "./form";
import { EyeIcon, EyeOffIcon } from "./icons";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "className">;

/** Password field with a show/hide toggle. */
export function PasswordInput(props: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} className={`${inputClass} pr-12`} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-12 cursor-pointer items-center justify-center text-muted transition hover:text-foreground"
      >
        {visible ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
      </button>
    </div>
  );
}

/** 0–4 rough strength score for the meter (not a security check). */
export function passwordScore(value: string) {
  if (!value) return 0;
  let score = value.length >= 8 ? 1 : 0;
  if (value.length >= 12) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score++;
  return Math.min(score, 4);
}

const LABELS = ["Too short", "Okay", "Good", "Strong", "Very strong"];

export function StrengthMeter({ value }: { value: string }) {
  const score = passwordScore(value);
  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-full transition-colors ${
              score >= step ? "bg-linear-to-r from-violet to-coral" : "bg-white/10"
            }`}
          />
        ))}
      </div>
      <span className="w-20 text-right text-xs text-muted">{value ? LABELS[score] : ""}</span>
    </div>
  );
}
