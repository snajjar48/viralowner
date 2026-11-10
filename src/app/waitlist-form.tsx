"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "submitting" | "success" | "error";

export function WaitlistForm() {
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
        You’re on the list. We’ll let you know when it’s your turn.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="email" className="sr-only">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          aria-invalid={status === "error"}
          aria-describedby={error ? "waitlist-error" : undefined}
          className="h-12 w-full min-w-0 flex-1 rounded-full border border-white/15 bg-white/5 px-5 text-base text-foreground placeholder:text-muted outline-none transition focus:border-white/40 focus:bg-white/[0.08]"
        />

        {/* Honeypot: hidden from people, tempting to bots. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
          <label htmlFor="website">Website</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <button
          type="submit"
          disabled={status === "submitting"}
          className="h-12 shrink-0 cursor-pointer rounded-full bg-linear-to-r from-violet to-coral px-6 text-base font-medium text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:cursor-wait disabled:opacity-70"
        >
          {status === "submitting" ? "Joining…" : "Join the waitlist"}
        </button>
      </div>

      <p id="waitlist-error" role="alert" className="mt-3 min-h-5 text-sm text-coral">
        {error}
      </p>
    </form>
  );
}
