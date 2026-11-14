"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

/** The ad tags in the page's link, so we know which ads bring people in. */
function adTags() {
  try {
    const q = new URLSearchParams(window.location.search);
    return ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref"]
      .filter((k) => q.get(k))
      .map((k) => `${k}=${q.get(k)}`)
      .join(" | ");
  } catch {
    return "";
  }
}

export function WaitlistForm({
  id = "email",
  source = "home",
  label = "join the waitlist",
}: {
  /** Unique per page when a page has more than one form. */
  id?: string;
  /** Which page or spot the form is on. */
  source?: string;
  label?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setStatus("submitting");
    setError("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.get("email"),
          website: data.get("website"),
          source: [source, adTags()].filter(Boolean).join(" | "),
        }),
      });
      const result = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(result.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("success");
    } catch {
      setError("Network error. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <p
        role="status"
        className="mx-auto max-w-sm text-base leading-relaxed text-foreground"
      >
        you’re on the list. we’ll email you when it’s your turn, with your free video ready to make.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor={id} className="sr-only">
          Email address
        </label>
        <input
          id={id}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          aria-invalid={status === "error"}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-12 w-full min-w-0 shrink-0 rounded-full sm:flex-1 border border-white/15 bg-white/5 px-5 text-base text-foreground placeholder:text-muted outline-none transition focus:border-white/40 focus:bg-white/[0.08]"
        />

        {/* Honeypot: hidden from people, tempting to bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor={`${id}-website`}>Website</label>
          <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <button
          type="submit"
          disabled={status === "submitting"}
          className="h-12 shrink-0 cursor-pointer rounded-full bg-linear-to-r from-violet to-coral px-6 text-base font-medium text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:cursor-wait disabled:opacity-70"
        >
          {status === "submitting" ? "joining…" : label}
        </button>
      </div>

      <p id={`${id}-error`} role="alert" className="mt-3 min-h-5 text-sm text-coral">
        {error}
      </p>
    </form>
  );
}
