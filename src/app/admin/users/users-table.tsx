"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type U = {
  id: string;
  name: string;
  email: string;
  plan: string | null;
  status: string | null;
  joined: string;
  lastSignIn: string | null;
  lastActive: string | null;
  /** Did something in the last 14 days. */
  recent: boolean;
  projects: number;
  videos: number;
  failed: number;
  bytes: number;
};

const ACTIVE = ["active", "trialing", "past_due"];
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "—";
const size = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`);

export function UsersTable({ users }: { users: U[] }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "paying" | "active">("all");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (only === "paying" && !(u.plan && ACTIVE.includes(u.status ?? ""))) return false;
      if (only === "active" && !u.recent) return false;
      return !needle || `${u.name} ${u.email}`.toLowerCase().includes(needle);
    });
  }, [users, q, only]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="search name or email"
          aria-label="search users"
          className="h-10 min-w-0 flex-1 rounded-full border border-white/10 bg-white/[0.04] px-4 text-sm outline-none focus:border-white/25"
        />
        {(["all", "paying", "active"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={only === f}
            onClick={() => setOnly(f)}
            className="h-9 cursor-pointer rounded-full border border-white/10 px-3 text-xs text-muted aria-pressed:border-transparent aria-pressed:bg-white aria-pressed:text-black"
          >
            {f === "active" ? "active in 14 days" : f}
          </button>
        ))}
        <span className="text-xs text-muted tabular-nums">{shown.length} of {users.length}</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs text-muted">
            <tr>
              <th className="p-3 font-normal">user</th>
              <th className="p-3 font-normal">plan</th>
              <th className="p-3 font-normal">joined</th>
              <th className="p-3 font-normal">last sign-in</th>
              <th className="p-3 font-normal">last active</th>
              <th className="p-3 text-right font-normal">projects</th>
              <th className="p-3 text-right font-normal">videos</th>
              <th className="p-3 text-right font-normal">failed</th>
              <th className="p-3 text-right font-normal">storage</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className="border-t border-white/[0.06] hover:bg-white/[0.03]">
                <td className="p-3">
                  <Link href={`/admin/users/${u.id}`} className="flex flex-col hover:underline">
                    <span className="font-medium">{u.name || "—"}</span>
                    <span className="text-xs text-muted">{u.email}</span>
                  </Link>
                </td>
                <td className="p-3">
                  {u.plan && ACTIVE.includes(u.status ?? "") ? (
                    <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-300">
                      {u.plan}
                      {u.status !== "active" ? ` · ${u.status}` : ""}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">{u.status ?? "free"}</span>
                  )}
                </td>
                <td className="p-3 text-muted">{day(u.joined)}</td>
                <td className="p-3 text-muted">{day(u.lastSignIn)}</td>
                <td className="p-3 text-muted">{day(u.lastActive)}</td>
                <td className="p-3 text-right tabular-nums">{u.projects}</td>
                <td className="p-3 text-right tabular-nums">{u.videos}</td>
                <td className={`p-3 text-right tabular-nums ${u.failed ? "text-coral" : "text-muted"}`}>{u.failed}</td>
                <td className="p-3 text-right tabular-nums text-muted">{size(u.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
