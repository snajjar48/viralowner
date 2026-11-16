"use client";

import Link from "next/link";
import { useState } from "react";
import type { TesterRow } from "@/lib/testers";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

type Row = TesterRow & { invite: string | null };

export function TestersManager({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  async function copy(r: Row) {
    if (!r.invite) return;
    try {
      await navigator.clipboard.writeText(r.invite);
      setCopied(r.email);
      setTimeout(() => setCopied((c) => (c === r.email ? "" : c)), 2000);
    } catch {
      prompt("copy this invite link:", r.invite);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/testers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, note }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { email?: string; invite?: string | null; error?: string } | null;
    setBusy(false);
    if (!res?.ok || !data?.email) return setError(data?.error ?? "couldn’t add that. try again.");
    const added = data.email;
    setRows((list) => [
      { email: added, note, addedAt: new Date().toISOString(), userId: null, projects: 0, versions: 0, lastActive: null, invite: data.invite ?? null },
      ...list.filter((r) => r.email !== added),
    ]);
    setEmail("");
    setNote("");
  }

  async function remove(r: Row) {
    if (!confirm(`take free access away from ${r.email}?`)) return;
    setError("");
    const res = await fetch("/api/admin/testers", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: r.email }),
    }).catch(() => null);
    if (res?.ok) setRows((list) => list.filter((x) => x.email !== r.email));
    else setError("couldn’t remove that. try again.");
  }

  const field = "h-10 rounded-lg border border-white/15 bg-[#15151b] px-3 text-sm outline-none focus-visible:border-coral";

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-muted">
          email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tester@example.com" className={field} />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-muted">
          note (optional)
          <input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. café owner, tests food videos" className={field} />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-10 cursor-pointer rounded-full bg-white px-5 text-sm font-medium text-black hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-50"
        >
          {busy ? "adding…" : "add tester"}
        </button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/[0.04] text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">tester</th>
              <th className="px-4 py-3 font-medium">signed up</th>
              <th className="px-4 py-3 font-medium">videos</th>
              <th className="px-4 py-3 font-medium">versions</th>
              <th className="px-4 py-3 font-medium">last active</th>
              <th className="px-4 py-3 font-medium">added</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email} className="border-t border-white/[0.06]">
                <td className="px-4 py-3">
                  <div className="font-medium">{r.email}</div>
                  {r.note && <div className="text-xs text-muted">{r.note}</div>}
                </td>
                <td className="px-4 py-3">
                  {r.userId ? (
                    <Link href={`/admin/users/${r.userId}`} className="text-emerald-300 hover:underline">
                      yes · see activity
                    </Link>
                  ) : (
                    <span className="text-muted">not yet</span>
                  )}
                </td>
                <td className="px-4 py-3 tabular-nums">{r.projects}</td>
                <td className="px-4 py-3 tabular-nums">{r.versions}</td>
                <td className="px-4 py-3 text-muted">{when(r.lastActive)}</td>
                <td className="px-4 py-3 text-muted">{when(r.addedAt)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {r.invite && !r.userId && (
                    <button type="button" onClick={() => copy(r)} className="mr-4 cursor-pointer text-xs text-violet-300 hover:text-white">
                      {copied === r.email ? "copied ✓" : "copy invite link"}
                    </button>
                  )}
                  <button type="button" onClick={() => remove(r)} className="cursor-pointer text-xs text-muted hover:text-coral">
                    remove
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-muted">
                  no testers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
