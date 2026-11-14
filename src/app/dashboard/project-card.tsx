"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  /** "Start from scratch": what the user described (searched too). */
  prompt: string;
  /** Still being made: can't be deleted yet. */
  busy: boolean;
}

/** The dot's color: the badge itself stays dark so it reads on any cover. */
const TONES: Record<ProjectCardData["tone"], string> = {
  ready: "bg-emerald-400",
  working: "bg-violet-300 motion-safe:animate-pulse",
  attention: "bg-coral",
  draft: "bg-white/60",
};

const NAME_MAX = 60;

/** One video on the dashboard: its cover, where it's at, and a menu to rename or delete it. */
export function ProjectCard({
  p,
  onRenamed,
  onDeleted,
}: {
  p: ProjectCardData;
  onRenamed: (name: string) => void;
  onDeleted: () => void;
}) {
  const name = p.name;
  const setName = onRenamed;
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu closes on a tap anywhere else, or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  async function remove() {
    setDeleting(true);
    setError("");
    const res = await fetch(`/api/projects/${p.id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      confirmRef.current?.close();
      onDeleted();
      return;
    }
    const body = (await res?.json().catch(() => null)) as { error?: string } | null;
    setDeleting(false);
    confirmRef.current?.close();
    setError(body?.error ?? "couldn’t delete it. try again.");
  }
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [coverFailed, setCoverFailed] = useState(false);
  const saving = useRef(false);

  function start() {
    setMenu(false);
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
          <div className="flex min-w-0 items-center gap-1">
            <button
              type="button"
              onClick={start}
              title="rename"
              className="-mx-1 flex min-w-0 flex-1 cursor-text items-center rounded-md px-1 text-left text-sm font-medium hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-coral"
            >
              <span className={`truncate ${name ? "" : "text-foreground/85"}`}>{title}</span>
              <span className="sr-only">(rename)</span>
            </button>
            <div ref={menuRef} className="relative shrink-0">
              <button
                type="button"
                aria-label={`more for ${title}`}
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu((m) => !m)}
                className="flex size-7 cursor-pointer items-center justify-center rounded-full text-muted transition hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral aria-expanded:bg-white/10"
              >
                <DotsIcon className="size-4" />
              </button>
              {menu && (
                <div
                  role="menu"
                  className="absolute right-0 bottom-full z-20 mb-1 flex w-36 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#17171d] p-1 text-sm shadow-xl shadow-black/50"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={start}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                  >
                    <PencilIcon className="size-3.5 text-muted" /> rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenu(false);
                      setError("");
                      confirmRef.current?.showModal();
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-coral hover:bg-coral/10 focus-visible:bg-coral/10 focus-visible:outline-none"
                  >
                    <TrashIcon className="size-3.5" /> delete
                  </button>
                </div>
              )}
            </div>
          </div>
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

      <dialog
        ref={confirmRef}
        aria-labelledby={`delete-${p.id}`}
        className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-white/10 bg-[#141419] p-6 text-foreground shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm"
      >
        <h3 id={`delete-${p.id}`} className="text-lg font-semibold text-balance">
          delete “{title}”?
        </h3>
        <p className="mt-2 text-sm text-pretty text-muted">
          {p.busy
            ? "this video is still being made. you can delete it once it’s finished."
            : "this deletes the video, every version of it and the clips you uploaded for it. it can’t be undone."}
          {!p.busy && p.version ? " download anything you want to keep first." : ""}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => confirmRef.current?.close()}
            className="h-11 cursor-pointer rounded-full px-5 text-sm font-medium text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
          >
            {p.busy ? "okay" : "keep it"}
          </button>
          {!p.busy && (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="h-11 cursor-pointer rounded-full bg-coral px-5 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:opacity-60"
            >
              {deleting ? "deleting…" : "delete"}
            </button>
          )}
        </div>
      </dialog>
    </li>
  );
}

function DotsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

function TrashIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
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
