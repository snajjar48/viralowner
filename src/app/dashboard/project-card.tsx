"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { FilmIcon, SparkleIcon } from "@/components/icons";

export interface ProjectCardData {
  id: string;
  href: string;
  /** The name the user gave it ("" if none). */
  name: string;
  /** What we call it when it has no name. */
  fallbackName: string;
  kind: "inspo" | "scratch";
  status: string;
  tone: "ready" | "working" | "attention" | "draft";
  /** "Nov 13", or "today". */
  when: string;
  version: number | null;
  cover: string | null;
}

/** The dot's color: the badge itself stays dark so it reads on any cover. */
const TONES: Record<ProjectCardData["tone"], string> = {
  ready: "bg-emerald-400",
  working: "bg-violet-300 motion-safe:animate-pulse",
  attention: "bg-coral",
  draft: "bg-white/60",
};

const NAME_MAX = 60;

/** One video on the dashboard: its cover, where it's at, and a name the user can change in place. */
export function ProjectCard({ p }: { p: ProjectCardData }) {
  const [name, setName] = useState(p.name);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [coverFailed, setCoverFailed] = useState(false);
  const saving = useRef(false);

  function start() {
    setDraft(name || p.fallbackName);
    setError("");
    setEditing(true);
  }

  async function save() {
    if (saving.current) return;
    const next = draft.replace(/\s+/g, " ").trim();
    setEditing(false);
    if (next === (name || p.fallbackName)) return;
    // Clearing it goes back to the name we made for it.
    const value = next === p.fallbackName ? "" : next;
    const before = name;
    setName(value);
    saving.current = true;
    const res = await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: value }),
    }).catch(() => null);
    saving.current = false;
    if (!res?.ok) {
      setName(before);
      const body = (await res?.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "couldn’t rename it. try again.");
    }
  }

  const title = name || p.fallbackName;

  return (
    <li className="group flex min-w-0 flex-col gap-2.5">
      <Link
        href={p.href}
        aria-label={`${title}: ${p.status}`}
        className="relative block aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 bg-linear-to-br from-violet/25 via-white/[0.03] to-coral/20 transition group-hover:border-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral"
      >
        {p.cover && !coverFailed ? (
          // eslint-disable-next-line @next/next/no-img-element -- a signed storage URL
          <img
            src={p.cover}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setCoverFailed(true)}
            className="size-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-white/40">
            {p.kind === "scratch" ? <SparkleIcon className="size-8" /> : <FilmIcon className="size-8" />}
          </span>
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/60 to-transparent" />
        <span
          className="absolute top-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white ring-1 ring-white/10 backdrop-blur-md"
        >
          <span className={`size-1.5 rounded-full ${TONES[p.tone]}`} />
          {p.status}
        </span>
        {p.version ? (
          <span className="absolute right-2 bottom-2 rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white/85 tabular-nums backdrop-blur-md">
            v{p.version}
          </span>
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        {editing ? (
          <input
            autoFocus
            value={draft}
            maxLength={NAME_MAX}
            aria-label="video name"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="-mx-1 h-7 rounded-md border border-coral/60 bg-white/5 px-1 text-sm font-medium outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={start}
            title="rename"
            className="-mx-1 flex min-w-0 cursor-text items-center gap-1.5 rounded-md px-1 text-left text-sm font-medium hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-coral"
          >
            <span className={`truncate ${name ? "" : "text-foreground/85"}`}>{title}</span>
            <PencilIcon className="size-3.5 shrink-0 text-muted opacity-60 transition group-hover:opacity-100" />
            <span className="sr-only">(rename)</span>
          </button>
        )}
        <span className="truncate text-xs text-muted">
          {p.kind === "scratch" ? "from scratch" : "remake"} · {p.when}
        </span>
        {error && (
          <span role="alert" className="text-xs text-coral">
            {error}
          </span>
        )}
      </div>
    </li>
  );
}

function PencilIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}
