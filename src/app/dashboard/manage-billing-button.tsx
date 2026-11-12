"use client";

import { useState } from "react";

/** Opens Stripe's billing page for this customer (viralowner plans only). */
export function ManageBillingButton({ label = "Manage billing" }: { label?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function open() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const result = await res.json().catch(() => ({}));
      if (res.ok && typeof result.url === "string") {
        window.location.assign(result.url);
        return;
      }
      setError(result.error ?? "Couldn’t open billing. Please try again.");
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={open}
        disabled={loading}
        className="h-11 cursor-pointer rounded-full border border-white/15 bg-white/5 px-5 text-sm font-medium transition hover:border-white/30 hover:bg-white/10 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Opening…" : label}
      </button>
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
    </div>
  );
}
