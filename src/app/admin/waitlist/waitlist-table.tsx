"use client";

import { useMemo, useState } from "react";

type W = { id: string; email: string; source: string; createdAt: string };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
/** "start-hero | utm_source=meta | utm_campaign=cafes" → its parts. */
const parts = (source: string) => source.split(" | ").filter(Boolean);

export function WaitlistTable({ initial }: { initial: W[] }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return rows.filter((r) => !n || `${r.email} ${r.source}`.toLowerCase().includes(n));
  }, [rows, q]);
  // Where signups come from: the page, and the ad campaign when there is one.
  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const page = parts(r.source)[0]?.replace(/-(hero|bottom)$/, "") || "unknown";
      const campaign = parts(r.source).find((x) => x.startsWith("utm_campaign="))?.slice(13);
      const key = campaign ? `${page} · ${campaign}` : page;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  function exportCsv() {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const csv = ["email,source,joined", ...shown.map((r) => [r.email, r.source, r.createdAt].map(esc).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `viralowner-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function remove(r: W) {
    if (!confirm(`remove ${r.email} from the waitlist?`)) return;
    setError("");
    const res = await fetch("/api/admin/waitlist", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: r.id }),
    }).catch(() => null);
    if (res?.ok) setRows((list) => list.filter((x) => x.id !== r.id));
    else setError("couldn’t remove that. try again.");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {sources.map(([k, n]) => (
          <span key={k} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs">
            {k} <span className="text-muted tabular-nums">· {n}</span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search email or source"
          aria-label="search the waitlist"
          className="h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm outline-none focus:border-white/25"
        />
        <span className="text-xs text-muted tabular-nums">{shown.length} of {rows.length}</span>
        <button
          type="button"
          onClick={exportCsv}
          className="h-10 cursor-pointer rounded-full bg-white px-4 text-sm font-medium text-black hover:bg-white/90"
        >
          export CSV
        </button>
      </div>
      {error && <p role="alert" className="text-sm text-coral">{error}</p>}
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs text-muted">
            <tr>
              <th className="p-3 font-normal">email</th>
              <th className="p-3 font-normal">source</th>
              <th className="p-3 font-normal">joined</th>
              <th className="p-3 font-normal"><span className="sr-only">remove</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className="border-t border-white/[0.06]">
                <td className="p-3">{r.email}</td>
                <td className="p-3 text-xs text-muted">{r.source || "—"}</td>
                <td className="p-3 whitespace-nowrap text-muted">{when(r.createdAt)}</td>
                <td className="p-3 text-right">
                  <button type="button" onClick={() => remove(r)} className="cursor-pointer text-xs text-muted hover:text-coral">
                    remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
