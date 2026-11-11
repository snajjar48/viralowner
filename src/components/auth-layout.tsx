import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { PlayIcon, WandIcon } from "./icons";

/** Soft violet/coral glow behind the page. */
export function BackgroundGlow() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-40 -left-32 size-[34rem] rounded-full bg-violet/25 blur-[140px] motion-safe:animate-[pulse_9s_ease-in-out_infinite]" />
      <div className="absolute top-1/3 -right-40 size-[30rem] rounded-full bg-coral/15 blur-[140px] motion-safe:animate-[pulse_11s_ease-in-out_infinite]" />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 30% 20%, black 20%, transparent 70%)",
        }}
      />
    </div>
  );
}

export function Logo({ className = "h-9 w-auto" }: { className?: string }) {
  return (
    <Link href="/" aria-label="viralowner home" className="inline-block">
      <Image src="/logo.svg" alt="viralowner" width={1458} height={418} className={className} />
    </Link>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium tracking-wide text-foreground/80">
      <span className="size-1.5 rounded-full bg-linear-to-r from-violet to-coral" />
      {children}
    </span>
  );
}

export function GradientText({ children }: { children: ReactNode }) {
  return (
    <span className="bg-linear-to-r from-violet via-[#a826a8] to-coral bg-clip-text text-transparent">
      {children}
    </span>
  );
}

/**
 * Two-column auth page: brand pitch on the left (top on mobile),
 * the form card on the right.
 */
export function AuthLayout({
  aside,
  title,
  subtitle,
  centered = false,
  children,
}: {
  aside: ReactNode;
  title: string;
  subtitle?: ReactNode;
  /** Vertically center both columns on desktop (for short forms). */
  centered?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="relative isolate min-h-dvh overflow-x-clip">
      <BackgroundGlow />
      <div className={`mx-auto grid min-h-dvh w-full max-w-6xl gap-12 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:gap-16 lg:py-16 ${centered ? "lg:items-center" : ""}`}>
        <aside className={`flex flex-col gap-10 lg:h-fit ${centered ? "" : "lg:sticky lg:top-16 lg:pt-2"}`}>
          <Logo />
          {aside}
        </aside>

        <main className="w-full">
          <div className="rounded-[28px] bg-linear-to-b from-white/15 via-white/5 to-white/5 p-px shadow-[0_30px_80px_-20px_rgba(105,27,234,0.35)]">
            <div className="rounded-[27px] bg-[#0f0f14]/90 p-6 backdrop-blur-xl sm:p-8">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
              {subtitle && <p className="mt-2 text-sm text-muted">{subtitle}</p>}
              <div className="mt-8">{children}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

/** Raw clip → finished edit, drawn in CSS. */
export function EditPreview() {
  return (
    <div aria-hidden="true" className="flex items-center gap-4 sm:gap-6">
      {/* Raw clip */}
      <div className="relative aspect-[9/16] w-28 shrink-0 overflow-hidden rounded-2xl border border-dashed border-white/15 bg-white/[0.03] sm:w-32">
        <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(255,255,255,0.03)_0_8px,transparent_8px_16px)]" />
        <span className="absolute top-2 left-2 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] text-muted">
          raw_clip.mov
        </span>
        <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
          <span className="h-1 flex-1 rounded-full bg-white/10">
            <span className="block h-full w-1/4 rounded-full bg-white/30" />
          </span>
          <span className="text-[10px] text-muted">2:47</span>
        </div>
      </div>

      <div className="flex flex-col items-center gap-1 text-muted">
        <span className="flex size-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
          <WandIcon className="size-5 text-foreground" />
        </span>
        <span className="text-[10px] tracking-wide uppercase">we edit</span>
      </div>

      {/* Finished edit */}
      <div className="relative aspect-[9/16] w-32 shrink-0 rounded-2xl bg-linear-to-b from-violet to-coral p-px shadow-[0_20px_60px_-15px_rgba(246,49,101,0.5)] sm:w-36">
        <div className="relative h-full overflow-hidden rounded-[15px] bg-[#120d1c]">
          <div className="absolute -top-8 -left-6 size-28 rounded-full bg-violet/50 blur-2xl" />
          <div className="absolute -right-6 -bottom-8 size-28 rounded-full bg-coral/40 blur-2xl" />
          <span className="absolute top-2 left-2 rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white">
            your spin
          </span>
          <span className="absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-white/20 backdrop-blur">
            <PlayIcon className="ml-0.5 size-5 text-white" />
          </span>
          <div className="absolute inset-x-2 bottom-8 flex flex-col items-center gap-1">
            <span className="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-black">
              POV: you skipped
            </span>
            <span className="rounded bg-coral px-1.5 py-0.5 text-[10px] font-bold text-white">
              the editing
            </span>
          </div>
          <div className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
            <span className="h-1 flex-1 rounded-full bg-white/20">
              <span className="block h-full w-2/3 rounded-full bg-white" />
            </span>
            <span className="text-[10px] text-white/80">0:15</span>
          </div>
        </div>
      </div>
    </div>
  );
}
