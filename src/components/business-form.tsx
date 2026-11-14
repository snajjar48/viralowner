"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/form";

export interface BusinessValues {
  name: string;
  about: string;
  city: string;
  words: string;
}

const FIELDS: { key: keyof BusinessValues; label: string; placeholder: string; max: number; hint?: string }[] = [
  { key: "name", label: "business name", placeholder: "e.g. Crepe Escape", max: 80 },
  { key: "about", label: "what you sell or do", placeholder: "e.g. crepes, bubble waffles, boba and milkshakes", max: 300 },
  { key: "city", label: "city", placeholder: "e.g. north olmsted, ohio", max: 80, hint: "optional" },
  {
    key: "words",
    label: "words we should always spell your way",
    placeholder: "e.g. boba, croffle, Crepe Escape, fat free milk",
    max: 300,
    hint: "product names, menu items, your name. separate them with commas.",
  },
];

/** The user's business, asked once and used on every video (captions, text and post captions). */
export function BusinessForm({
  initial,
  onSaved,
  submitLabel = "save",
}: {
  initial: BusinessValues;
  onSaved?: (values: BusinessValues) => void;
  submitLabel?: string;
}) {
  const [values, setValues] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setState("saving");
    setError("");
    const res = await fetch("/api/business", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    }).catch(() => null);
    if (!res?.ok) {
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "couldn’t save. check your connection and try again.");
      setState("error");
      return;
    }
    setState("saved");
    onSaved?.(values);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      {FIELDS.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <label htmlFor={`business-${f.key}`} className="text-sm text-muted">
            {f.label}
            {f.hint === "optional" && <span className="text-muted/70"> · optional</span>}
          </label>
          <input
            id={`business-${f.key}`}
            value={values[f.key]}
            maxLength={f.max}
            placeholder={f.placeholder}
            onChange={(e) => {
              setValues((v) => ({ ...v, [f.key]: e.target.value }));
              setState("idle");
            }}
            className={inputClass}
          />
          {f.hint && f.hint !== "optional" && <span className="text-xs text-muted">{f.hint}</span>}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
      <button type="submit" disabled={state === "saving"} className={`${buttonClass} disabled:opacity-50`}>
        {state === "saving" ? "saving…" : state === "saved" ? "saved" : submitLabel}
      </button>
    </form>
  );
}
