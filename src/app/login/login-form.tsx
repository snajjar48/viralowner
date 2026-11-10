"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass, Field, FormError, inputClass } from "@/components/form";
import { ArrowRightIcon } from "@/components/icons";
import { PasswordInput } from "@/components/password-input";
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
        <input id="email" name="email" type="email" required autoFocus autoComplete="email" placeholder="you@example.com" className={inputClass} />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput id="password" name="password" required autoComplete="current-password" />
      </Field>
      <div className="mt-4 flex flex-col gap-3">
        <button type="submit" disabled={submitting} className={`${buttonClass} group`}>
          <span className="inline-flex items-center justify-center gap-2">
            {submitting ? "Logging in…" : "Log in"}
            {!submitting && (
              <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            )}
          </span>
        </button>
        <FormError id="login-error" message={error} />
      </div>

      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="h-px flex-1 bg-white/10" />
        new to viralowner?
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <Link
        href="/signup"
        className="flex h-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-sm font-medium transition hover:border-white/30 hover:bg-white/10"
      >
        Create an account
      </Link>
    </form>
  );
}
