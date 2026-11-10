"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass, Field, FormError, inputClass } from "@/components/form";
import { safeNextPath } from "@/lib/safe-next";

const LINK_ERROR = "That confirmation link is invalid or has expired. Try logging in.";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [error, setError] = useState(searchParams.get("error") === "link" ? LINK_ERROR : "");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      if (res.ok) {
        window.location.assign(safeNextPath(searchParams.get("next")));
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" required autoFocus autoComplete="email" className={inputClass} />
      </Field>
      <Field label="Password" htmlFor="password">
        <input id="password" name="password" type="password" required autoComplete="current-password" className={inputClass} />
      </Field>
      <div className="mt-4 flex flex-col gap-3">
        <button type="submit" disabled={submitting} className={buttonClass}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
        <FormError id="login-error" message={error} />
        <p className="text-center text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="text-foreground underline underline-offset-4">
            Create an account
          </Link>
        </p>
      </div>
    </form>
  );
}
