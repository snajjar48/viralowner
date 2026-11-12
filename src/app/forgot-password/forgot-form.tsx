"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { buttonClass, Field, FormError, inputClass } from "@/components/form";

export function ForgotForm() {
  const [sentTo, setSentTo] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) return setError(result.error ?? "Something went wrong. Please try again.");
      setSentTo(email);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sentTo) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className="text-muted text-pretty">
          If there’s an account for <span className="text-foreground">{sentTo}</span>, we just sent it a link to
          reset your password. It can take a minute, so check your spam folder too.
        </p>
        <Link href="/login" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
          back to log in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <p className="text-center text-muted text-pretty">
        Enter the email you signed up with and we’ll send you a link to pick a new password.
      </p>
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" required autoFocus autoComplete="email" placeholder="you@example.com" className={inputClass} />
      </Field>
      <button type="submit" disabled={submitting} className={`${buttonClass} mt-2`}>
        {submitting ? "Sending…" : "Send reset link"}
      </button>
      <FormError id="forgot-error" message={error} />
      <Link href="/login" className="text-center text-sm text-muted underline underline-offset-4 hover:text-foreground">
        back to log in
      </Link>
    </form>
  );
}
