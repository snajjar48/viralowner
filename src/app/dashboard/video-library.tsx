"use client";

import { useMemo, useState } from "react";
import { FilmIcon, XIcon } from "@/components/icons";
import { ProjectCard, type ProjectCardData } from "./project-card";

type Filter = "all" | "ready" | "progress";

const FILTERS: { id: Filter; label: string; test: (p: ProjectCardData) => boolean }[] = [
  { id: "all", label: "all", test: () => true },
  { id: "ready", label: "ready to post", test: (p) => p.tone === "ready" },
  { id: "progress", label: "in progress", test: (p) => p.tone !== "ready" },
];

/** Lowercase words without accents or punctuation, so "Crêpe-escape" finds "crepe escape". */
function words(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$#@]+/g, " ")
    .trim();
}

/** The user's videos: search, filter, and each one's rename / delete. */
export function VideoLibrary({ initial }: { initial: ProjectCardData[] }) {
  const [cards, setCards] = useState(initial);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    const q = words(query).split(" ").filter(Boolean);
    const test = FILTERS.find((f) => f.id === filter)!.test;
    return cards.filter((p) => {
      if (!test(p)) return false;
      if (!q.length) return true;
      const hay = words([p.name, p.fallbackName, p.prompt, p.kind === "scratch" ? "from scratch" : "remake", p.status, p.when].join(" "));
      return q.every((w) => hay.includes(w));
    });
  }, [cards, query, filter]);

  const update = (id: string, change: Partial<ProjectCardData> | null) =>
    setCards((list) => (change ? list.map((p) => (p.id === id ? { ...p, ...change } : p)) : list.filter((p) => p.id !== id)));

  return (
    <section aria-labelledby="videos-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="videos-heading" className="text-xl font-semibold tracking-tight">
          your videos
        </h2>
        {cards.length > 0 && (
          <span className="text-sm text-muted tabular-nums">
            {cards.length} {cards.length === 1 ? "video" : "videos"}
          </span>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-white/15 px-6 py-12 text-center">
          <FilmIcon className="size-7 text-muted" />
          <p className="font-medium">no videos yet</p>
          <p className="text-sm text-muted">the videos you make show up here, so you can come back to them any time.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search your videos"
                aria-label="search your videos"
                className="h-11 w-full rounded-full border border-white/10 bg-white/[0.04] pr-10 pl-10 text-sm outline-none placeholder:text-muted/80 focus:border-white/25 [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="clear search"
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-white/10 hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
                >
                  <XIcon className="size-3.5" />
                </button>
              )}
            </div>
            <div className="flex gap-1.5" role="group" aria-label="show">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className="h-9 shrink-0 cursor-pointer rounded-full border border-white/10 px-3.5 text-xs font-medium text-muted transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral aria-pressed:border-transparent aria-pressed:bg-white aria-pressed:text-black"
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-3xl border border-dashed border-white/15 px-6 py-10 text-center text-sm text-muted">
              {query ? `no videos match “${query.trim()}”.` : "nothing here yet."}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
              {shown.map((p) => (
                <ProjectCard
                  key={p.id}
                  p={p}
                  onRenamed={(name) => update(p.id, { name })}
                  onDeleted={() => update(p.id, null)}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function SearchIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}
