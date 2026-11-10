"use client";

import { useState, type FormEvent } from "react";

function nextPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  // Mirror the server-side check: same-site relative paths only.
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/dashboard";
  }
  return next;
}

export function UnlockForm() {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.assign(nextPath());
        return;
      }
      const result = await res.json().catch(() => ({}));
      setError(result.error ?? "Something went wrong. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="password" className="sr-only">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        required
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        aria-describedby={error ? "unlock-error" : undefined}
        className="h-12 w-full rounded-full border border-white/15 bg-white/5 px-5 text-base text-foreground placeholder:text-muted outline-none transition focus:border-white/40 focus:bg-white/[0.08]"
      />
      <button
        type="submit"
        disabled={submitting}
        className="h-12 cursor-pointer rounded-full bg-linear-to-r from-violet to-coral px-6 text-base font-medium text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:cursor-wait disabled:opacity-70"
      >
        {submitting ? "Checking…" : "Enter"}
      </button>
      <p id="unlock-error" role="alert" className="min-h-5 text-center text-sm text-coral">
        {error}
      </p>
    </form>
  );
}
