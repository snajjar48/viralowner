"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/what-is-viralowner", label: "how it works" },
  { href: "/why-viralowner", label: "why us" },
  { href: "/pricing", label: "pricing" },
];

/** The public site's links and main button (a menu on phones). */
export function MarketingNav({ cta }: { cta: { href: string; label: string } }) {
  return (
    <Suspense fallback={<Nav path={null} cta={cta} />}>
      <CurrentNav cta={cta} />
    </Suspense>
  );
}

function CurrentNav({ cta }: { cta: { href: string; label: string } }) {
  return <Nav path={usePathname()} cta={cta} />;
}

function Nav({ path, cta }: { path: string | null; cta: { href: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    <nav aria-label="main" ref={ref} className="relative flex items-center gap-2">
      <ul className="hidden items-center gap-1 md:flex">
        {LINKS.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={path === l.href ? "page" : undefined}
              className="rounded-full px-3.5 py-2 text-sm text-muted transition hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral aria-[current=page]:text-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={cta.href}
        className="hidden h-10 items-center rounded-full bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral sm:inline-flex"
      >
        {cta.label}
      </Link>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="public-menu"
        aria-label="menu"
        className="flex size-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.04] transition hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-coral md:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" aria-hidden="true" className="size-4">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 8h16M4 16h16" />}
        </svg>
      </button>
      {open && (
        <div
          id="public-menu"
          className="absolute top-full right-0 z-50 mt-2 flex w-[min(18rem,calc(100vw-2rem))] flex-col gap-1 rounded-3xl border border-white/10 bg-[#141419]/95 p-2 shadow-2xl shadow-black/60 backdrop-blur-xl md:hidden"
        >
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              aria-current={path === l.href ? "page" : undefined}
              className="rounded-2xl px-4 py-3 text-base hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-coral aria-[current=page]:bg-white/[0.08]"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href={cta.href}
            onClick={() => setOpen(false)}
            className="mt-1 flex h-12 items-center justify-center rounded-full bg-linear-to-r from-violet to-coral text-base font-medium text-white"
          >
            {cta.label}
          </Link>
        </div>
      )}
    </nav>
  );
}
