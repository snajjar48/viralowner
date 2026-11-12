"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass, Field, FormError } from "@/components/form";
import { PasswordInput, StrengthMeter } from "@/components/password-input";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/signup-validation";

export function ResetForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) return setError("Passwords don’t match.");
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) return setError(result.error ?? "Something went wrong. Please try again.");
      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="New password" htmlFor="password">
        <PasswordInput id="password" name="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" autoFocus placeholder={`At least ${PASSWORD_MIN} characters`} value={password} onChange={(e) => setPassword(e.target.value)} />
      </Field>
      <StrengthMeter value={password} />
      <Field label="Confirm new password" htmlFor="confirm">
        <PasswordInput id="confirm" name="confirm" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </Field>
      <button type="submit" disabled={submitting} className={`${buttonClass} mt-2`}>
        {submitting ? "Saving…" : "Save new password"}
      </button>
      <FormError id="reset-error" message={error} />
    </form>
  );
}
