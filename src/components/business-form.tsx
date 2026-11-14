"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/form";

export interface BusinessValues {
  name: string;
  about: string;
  city: string;
  words: string;
  role: string;
  purpose: string;
  notes: string;
}

export const EMPTY_PROFILE: BusinessValues = { name: "", about: "", city: "", words: "", role: "", purpose: "", notes: "" };

type Field = {
  key: keyof BusinessValues;
  label: string;
  placeholder: string;
  max: number;
  hint?: string;
  optional?: boolean;
  /** One tap fills (or, for lists, adds) a common answer. */
  suggestions?: { list: boolean; options: string[] };
  multiline?: boolean;
};

const ROLE: Field = {
  key: "role",
  label: "your role",
  placeholder: "e.g. owner",
  max: 80,
  suggestions: { list: false, options: ["owner", "manager", "social media manager", "content creator", "agency"] },
};
const PURPOSE: Field = {
  key: "purpose",
  label: "what you’re making videos for",
  placeholder: "e.g. bring more customers into my shop",
  max: 200,
  suggestions: {
    list: true,
    options: ["more customers in the door", "growing my following", "launching new products", "videos for my clients", "hiring"],
  },
};
const NAME: Field = { key: "name", label: "business or brand name", placeholder: "e.g. Crepe Escape", max: 80 };
const ABOUT: Field = {
  key: "about",
  label: "what you sell or do",
  placeholder: "e.g. crepes, bubble waffles, boba and milkshakes",
  max: 300,
};
const CITY: Field = { key: "city", label: "city", placeholder: "e.g. north olmsted, ohio", max: 80, optional: true };
const WORDS: Field = {
  key: "words",
  label: "words we should always spell your way",
  placeholder: "e.g. boba, croffle, Crepe Escape, fat free milk",
  max: 300,
  hint: "product names, menu items, people’s names. separate them with commas.",
};
const NOTES: Field = {
  key: "notes",
  label: "anything we should remember for every video",
  placeholder:
    "e.g. our colors are pink and black. never say “cheap”. we’re family owned. always mention we’re open late on weekends.",
  max: 1000,
  optional: true,
  multiline: true,
  hint: "your tone, things to always or never say, your slogan, your audience. we use it on every video.",
};

const SECTIONS: { title: string; fields: Field[] }[] = [
  { title: "about you", fields: [ROLE, PURPOSE] },
  { title: "your business", fields: [NAME, ABOUT, CITY] },
  { title: "spelling", fields: [WORDS] },
  { title: "remember this", fields: [NOTES] },
];
/** The few that matter most, for the one-time card before a first video. */
const SHORT: Field[] = [NAME, ROLE, ABOUT, WORDS];

/** The user's profile, asked once and used on every video (captions, text, edits and post captions). */
export function BusinessForm({
  initial,
  onSaved,
  submitLabel = "save",
  short = false,
}: {
  initial: BusinessValues;
  onSaved?: (values: BusinessValues) => void;
  submitLabel?: string;
  /** Only the essentials (the rest can be added on the profile page). */
  short?: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  function set(key: keyof BusinessValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setState("idle");
  }

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

  const field = (f: Field) => <FieldInput key={f.key} field={f} value={values[f.key]} onChange={(v) => set(f.key, v)} />;

  return (
    <form onSubmit={save} className="flex flex-col gap-5">
      {short ? (
        <div className="flex flex-col gap-4">{SHORT.map(field)}</div>
      ) : (
        SECTIONS.map((s) => (
          <fieldset key={s.title} className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <legend className="sr-only">{s.title}</legend>
            <p aria-hidden="true" className="text-xs font-medium tracking-wide text-muted uppercase">
              {s.title}
            </p>
            {s.fields.map(field)}
          </fieldset>
        ))
      )}
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
      <button type="submit" disabled={state === "saving"} className={`${buttonClass} disabled:opacity-50`}>
        {state === "saving" ? "saving…" : state === "saved" ? "saved ✓" : submitLabel}
      </button>
    </form>
  );
}

function FieldInput({ field: f, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const id = `profile-${f.key}`;
  const picked = (o: string) =>
    f.suggestions?.list
      ? value
          .split(",")
          .map((x) => x.trim().toLowerCase())
          .includes(o)
      : value.trim().toLowerCase() === o;

  function tap(o: string) {
    if (!f.suggestions?.list) return onChange(picked(o) ? "" : o);
    const items = value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const next = picked(o) ? items.filter((x) => x.toLowerCase() !== o) : [...items, o];
    const text = next.join(", ");
    if (text.length <= f.max) onChange(text);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {f.label}
        {f.optional && <span className="text-muted/70"> · optional</span>}
      </label>
      {f.multiline ? (
        <textarea
          id={id}
          value={value}
          maxLength={f.max}
          rows={4}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} h-auto py-3 leading-relaxed`}
        />
      ) : (
        <input
          id={id}
          value={value}
          maxLength={f.max}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      )}
      {f.suggestions && (
        <div className="flex flex-wrap gap-1.5">
          {f.suggestions.options.map((o) => (
            <button
              key={o}
              type="button"
              aria-pressed={picked(o)}
              onClick={() => tap(o)}
              className="h-8 cursor-pointer rounded-full border border-white/12 px-3 text-xs text-muted transition hover:border-white/25 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral aria-pressed:border-coral/60 aria-pressed:bg-coral/10 aria-pressed:text-foreground"
            >
              {o}
            </button>
          ))}
        </div>
      )}
      {f.hint && <span className="text-xs text-muted">{f.hint}</span>}
    </div>
  );
}
