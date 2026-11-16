"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass, Field, FormError, inputClass } from "@/components/form";
import { ArrowRightIcon } from "@/components/icons";
import { PasswordInput, StrengthMeter } from "@/components/password-input";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/signup-validation";

export function TesterSignupForm({ email, token }: { email: string; token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    if (password !== confirmPassword) return setError("Passwords don’t match.");
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/tester-signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          token,
          firstName: String(data.get("firstName") ?? ""),
          lastName: String(data.get("lastName") ?? ""),
          password,
          confirmPassword,
          acceptTerms: data.get("acceptTerms") === "on",
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) return setError(result.error ?? "Something went wrong. Please try again.");
      if (result.needsEmailConfirmation) return setCheckEmail(true);
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkEmail) {
    return (
      <p className="text-sm text-pretty text-muted">
        Almost there: we sent a link to <span className="text-foreground">{email}</span>. Open it to finish setting up
        your account.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="firstName">
          <input id="firstName" name="firstName" required maxLength={50} autoComplete="given-name" className={inputClass} />
        </Field>
        <Field label="Last name" htmlFor="lastName">
          <input id="lastName" name="lastName" required maxLength={50} autoComplete="family-name" className={inputClass} />
        </Field>
      </div>
      <Field label="Email" htmlFor="email">
        <input id="email" value={email} readOnly className={inputClass} />
      </Field>
      <Field label="Password" htmlFor="password">
        <PasswordInput
          id="password"
          name="password"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <StrengthMeter value={password} />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword">
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          required
          minLength={PASSWORD_MIN}
          maxLength={PASSWORD_MAX}
          autoComplete="new-password"
        />
      </Field>
      <label className="flex cursor-pointer items-start gap-3 text-sm text-muted">
        <input name="acceptTerms" type="checkbox" required className="mt-0.5 size-4 shrink-0 cursor-pointer accent-violet" />
        <span>
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="text-foreground underline underline-offset-4">
            terms and conditions
          </Link>
          .
        </span>
      </label>
      <FormError id="tester-signup-error" message={error} />
      <button type="submit" disabled={submitting} className={`${buttonClass} flex items-center justify-center gap-2`}>
        {submitting ? "Creating your account…" : "Create my account"}
        {!submitting && <ArrowRightIcon className="size-5" />}
      </button>
    </form>
  );
}
