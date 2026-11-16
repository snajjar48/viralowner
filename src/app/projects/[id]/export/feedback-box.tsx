"use client";

import { useState } from "react";

const RATINGS = [
  { id: "loved", label: "loved it" },
  { id: "okay", label: "it’s okay" },
  { id: "not_quite", label: "not quite" },
] as const;

/** "How did it turn out?": a quick rating and a note, so we can make viralowner better. */
export function FeedbackBox({ projectId, version }: { projectId: string; version: number }) {
  const [rating, setRating] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!rating && !message.trim()) return;
    setState("sending");
    setError(null);
    const res = await fetch(`/api/projects/${projectId}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version, rating, message }),
    }).catch(() => null);
    if (res?.ok) return setState("sent");
    const data = await res?.json().catch(() => null);
    setError(data?.error ?? "couldn’t send it. please try again.");
    setState("idle");
  }

  if (state === "sent") {
    return <p className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm">thank you! we read every note.</p>;
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <div role="group" aria-label="how did this video turn out?" className="flex flex-wrap gap-2">
        {RATINGS.map((r) => (
          <button
            key={r.id}
            type="button"
            aria-pressed={rating === r.id}
            onClick={() => setRating(rating === r.id ? null : r.id)}
            className={`h-9 cursor-pointer rounded-full px-4 text-sm transition focus-visible:outline-2 focus-visible:outline-coral ${
              rating === r.id ? "bg-linear-to-r from-violet to-coral font-medium text-white" : "border border-white/15 text-muted hover:text-foreground"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="feedback">
        your feedback
      </label>
      <textarea
        id="feedback"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        maxLength={3000}
        rows={3}
        placeholder="what would have made this video better? anything confusing or slow?"
        className="w-full rounded-xl border border-white/15 bg-white/[0.04] p-3 text-sm placeholder:text-muted focus:border-coral focus:outline-none"
      />
      {error && <p className="text-sm text-coral">{error}</p>}
      <button
        type="submit"
        disabled={state === "sending" || (!rating && !message.trim())}
        className="h-11 w-fit cursor-pointer rounded-full bg-white/10 px-5 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state === "sending" ? "sending…" : "send feedback"}
      </button>
    </form>
  );
}
