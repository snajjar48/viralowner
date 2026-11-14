import type { ReactNode } from "react";
import { BackgroundGlow, Logo } from "./auth-layout";
import { ProgressSteps } from "./progress-steps";
import { SiteNav } from "./site-nav";

/** Page frame for the "create a video" flow. Mobile-first. */
export function FlowShell({
  step,
  projectId,
  width = "narrow",
  children,
}: {
  /** Shows the 3-step indicator (steps 1–3 only). */
  step?: 1 | 2 | 3;
  projectId?: string;
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  return (
    <div className="relative isolate min-h-dvh">
      <BackgroundGlow />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pt-4 sm:px-6 sm:pt-6">
        <Logo className="h-7 w-auto" />
        <SiteNav />
      </header>
      <main
        className={`mx-auto flex w-full flex-col gap-6 px-4 pt-6 pb-16 sm:px-6 sm:pt-10 ${
          width === "wide" ? "max-w-5xl" : "max-w-xl"
        }`}
      >
        {step && <ProgressSteps current={step} projectId={projectId} />}
        {children}
      </main>
    </div>
  );
}

export function PageTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
      {subtitle && <p className="text-muted text-pretty">{subtitle}</p>}
    </div>
  );
}

/** Centered message for loading, empty and error states. */
export function StateCard({
  icon,
  title,
  children,
  tone = "neutral",
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  tone?: "neutral" | "error";
}) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
      className={`flex flex-col items-center gap-3 rounded-2xl border p-6 text-center ${
        tone === "error" ? "border-coral/30 bg-coral/[0.06]" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      {icon}
      <p className="text-lg font-medium">{title}</p>
      {children}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">loading…</span>
      <div className="h-8 w-2/3 animate-pulse rounded-lg bg-white/[0.06]" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-white/[0.06]" />
      <div className="h-56 w-full animate-pulse rounded-2xl bg-white/[0.04]" />
    </div>
  );
}
