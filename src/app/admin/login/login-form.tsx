"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, inputClass } from "@/components/form";

export function AdminLoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    if (res?.ok) {
      router.replace("/admin");
      router.refresh();
      return;
    }
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? "something went wrong. please try again.");
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label htmlFor="admin-password" className="text-sm text-muted">
        admin password
      </label>
      <input
        id="admin-password"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={inputClass}
        autoFocus
      />
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy || !password} className={`${buttonClass} disabled:opacity-50`}>
        {busy ? "checking…" : "open admin"}
      </button>
    </form>
  );
}
