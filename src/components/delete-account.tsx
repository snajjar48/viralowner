"use client";

import { useState } from "react";

/** "delete my account": the account, its videos and its files, for good (and the ViralOwner plan canceled). */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "something went wrong. please try again.");
      window.location.assign("/login?deleted=1"); // a full load: nothing of the old session stays
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="delete-account" className="mt-10 flex flex-col gap-3 rounded-2xl border border-coral/25 bg-coral/[0.04] p-4">
      <h2 id="delete-account" className="text-base font-semibold">
        delete my account
      </h2>
      <p className="text-sm text-muted">
        this deletes your account, every video and clip you’ve uploaded or made, and your profile, for good. if you have a
        plan, it’s canceled right away and you won’t be charged again. download any videos you want to keep first.
      </p>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-11 w-fit cursor-pointer rounded-full border border-coral/40 px-5 text-sm font-medium text-coral hover:bg-coral/10 focus-visible:outline-2 focus-visible:outline-coral"
        >
          delete my account
        </button>
      ) : (
        <div className="flex flex-col gap-2">
          <label htmlFor="confirm-delete" className="text-sm">
            type <strong>delete</strong> to confirm
          </label>
          <input
            id="confirm-delete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            className="h-11 rounded-xl border border-white/15 bg-[#15151b] px-3 text-sm outline-none focus-visible:border-coral"
          />
          {error && (
            <p role="alert" className="text-sm text-coral">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={busy || typed.trim().toLowerCase() !== "delete"}
              className="h-11 cursor-pointer rounded-full bg-coral px-5 text-sm font-medium text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "deleting…" : "delete everything"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError("");
              }}
              disabled={busy}
              className="h-11 cursor-pointer rounded-full bg-white/10 px-5 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-coral"
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
