"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { EmojiKitSync } from "./emoji-kit-sync";
import { FilmIcon, PlayIcon, TrendIcon, WandIcon } from "./icons";

type Item = {
  href: string;
  label: string;
  /** Shorter label for the desktop bar. */
  short: string;
  blurb: string;
  icon: ReactNode;
  pro?: boolean;
  /** Pages that count as this item. */
  match: (path: string) => boolean;
};

const ITEMS: Item[] = [
  {
    href: "/dashboard",
    label: "my videos",
    short: "my videos",
    blurb: "everything you’ve made and your drafts",
    icon: <FilmIcon className="size-4" />,
    match: (p) => p === "/dashboard" || p.startsWith("/projects/"),
  },
  {
    href: "/new",
    label: "remake a viral video",
    short: "remake",
    blurb: "upload a video that went viral, we remake it with your clips",
    icon: <TrendIcon className="size-4" />,
    match: (p) => p === "/new",
  },
  {
    href: "/scratch",
    label: "start from scratch",
    short: "from scratch",
    blurb: "describe the video you want, we plan the whole edit",
    icon: <WandIcon className="size-4" />,
    pro: true,
    match: (p) => p === "/scratch",
  },
  {
    href: "/tutorials",
    label: "tutorials",
    short: "tutorials",
    blurb: "step by step, with what to tap on each screen",
    icon: <PlayIcon className="size-4" />,
    match: (p) => p === "/tutorials",
  },
  {
    href: "/tips",
    label: "tips",
    short: "tips",
    blurb: "ideas, filming and getting it right the first time",
    icon: <BulbIcon className="size-4" />,
    match: (p) => p === "/tips",
  },
  {
    href: "/profile",
    label: "your profile",
    short: "profile",
    blurb: "your business and what we remember for every video",
    icon: <PersonIcon className="size-4" />,
    match: (p) => p === "/profile",
  },
];

/** The menu on every signed-in page: my videos, the two ways to start a video, tutorials, tips, the profile, and log out. */
export function SiteNav() {
  return (
    <>
      <Suspense fallback={<Nav path={null} />}>
        <CurrentNav />
      </Suspense>
      {/* This device's emoji, for this person's videos. */}
      <EmojiKitSync />
    </>
  );
}

function CurrentNav() {
  return <Nav path={usePathname()} />;
}

function Nav({ path }: { path: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = (item: Item) => !!path && item.match(path);
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function logOut() {
    setLeaving(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/");
    router.refresh(); // drop any cached private pages from the client router
  }

  // The phone menu closes on a tap outside or Escape.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <nav aria-label="main" ref={ref} className="relative">
      {/* Desktop: one bar. */}
      <ul className="hidden items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1 backdrop-blur-md md:flex">
        {ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active(item) ? "page" : undefined}
              className="flex h-8 items-center gap-1.5 rounded-full px-3 text-sm text-muted transition hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral aria-[current=page]:bg-white aria-[current=page]:text-black"
            >
              {item.short}
              {item.pro && <ProBadge />}
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={logOut}
            disabled={leaving}
            className="flex h-8 cursor-pointer items-center rounded-full px-3 text-sm text-muted transition hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-60"
          >
            {leaving ? "logging out…" : "log out"}
          </button>
        </li>
      </ul>

      {/* Phone: a menu button and a panel. */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="site-menu"
        className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] pr-4 pl-3 text-sm font-medium backdrop-blur-md transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral md:hidden"
      >
        <MenuIcon open={open} className="size-4" />
        menu
      </button>
      {open && (
        <div
          id="site-menu"
          className="absolute top-full right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-3xl border border-white/10 bg-[#141419]/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl md:hidden"
        >
          <ul className="flex flex-col gap-0.5">
            {ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active(item) ? "page" : undefined}
                  className="flex items-start gap-3 rounded-2xl p-3 transition hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-coral aria-[current=page]:bg-white/[0.08]"
                >
                  <span
                    className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl ${
                      active(item) ? "bg-linear-to-br from-violet to-coral text-white" : "bg-white/10 text-foreground"
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {item.label}
                      {item.pro && <ProBadge />}
                    </span>
                    <span className="text-xs text-pretty text-muted">{item.blurb}</span>
                  </span>
                </Link>
              </li>
            ))}
            <li className="mt-1 border-t border-white/10 pt-1">
              <button
                type="button"
                onClick={logOut}
                disabled={leaving}
                className="flex w-full cursor-pointer items-center gap-3 rounded-2xl p-3 text-left text-sm font-medium transition hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-coral disabled:opacity-60"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-white/10 text-foreground">
                  <ExitIcon className="size-4" />
                </span>
                {leaving ? "logging out…" : "log out"}
              </button>
            </li>
          </ul>
        </div>
      )}
    </nav>
  );
}

function ProBadge() {
  return (
    <span className="rounded-full bg-linear-to-r from-violet to-coral px-1.5 py-px text-[10px] font-medium text-white">Plus</span>
  );
}

function MenuIcon({ open, ...props }: React.SVGProps<SVGSVGElement> & { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" {...props}>
      {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
    </svg>
  );
}

function BulbIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0 0 12 3Z" />
    </svg>
  );
}

function PersonIcon(props: React.SVGProps<SVGSVGElement>) {
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
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c1.2-3.5 3.8-5 7-5s5.8 1.5 7 5" />
    </svg>
  );
}

function ExitIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </svg>
  );
}
