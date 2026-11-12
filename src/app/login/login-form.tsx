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
  // Set to the email when login says it isn't confirmed yet.
  const [unconfirmed, setUnconfirmed] = useState("");
  const [resent, setResent] = useState(false);

  async function resend() {
    setResent(true);
    await fetch("/api/auth/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: unconfirmed }),
    }).catch(() => null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setSubmitting(true);
    setError("");
    setUnconfirmed("");
    setResent(false);

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
      if (result.unconfirmed) setUnconfirmed(String(data.get("email") ?? ""));
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
      <Link href="/forgot-password" className="-mt-1 self-end text-sm text-muted underline underline-offset-4 hover:text-foreground">
        forgot your password?
      </Link>
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
        {unconfirmed && (
          <button
            type="button"
            onClick={resend}
            disabled={resent}
            className="text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:no-underline"
          >
            {resent ? "sent. check your inbox (and spam)." : "send the confirmation link again"}
          </button>
        )}
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
