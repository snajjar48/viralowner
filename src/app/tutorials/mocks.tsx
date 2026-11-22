import type { ReactNode } from "react";

/**
 * Small drawings of the app's screens for the tutorials: the same labels, colors and shapes as the
 * real pages, simplified, with a coral ring on what to tap. Drawn (not screenshots) so they stay
 * sharp at any size and are easy to keep in step with the app.
 */

/** A phone showing one screen. */
export function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <figure
      role="img"
      aria-label={label}
      className="relative mx-auto flex aspect-[9/15] w-full max-w-[15rem] shrink-0 flex-col gap-2 overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#0B0B0F] p-3 pt-6 text-[10px] leading-snug text-foreground shadow-[0_20px_60px_-20px_rgba(123,47,247,0.5)]"
    >
      <span aria-hidden="true" className="absolute top-2 left-1/2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-white/15" />
      {children}
    </figure>
  );
}

/** What to tap: a pulsing coral ring and a "tap" tag. */
export function Tap({ children, className = "", tag = "tap" }: { children: ReactNode; className?: string; tag?: string }) {
  return (
    <span className={`relative block rounded-[inherit] ${className}`}>
      {children}
      <span aria-hidden="true" className="pointer-events-none absolute -inset-1 rounded-xl ring-2 ring-coral motion-safe:animate-pulse" />
      <span
        aria-hidden="true"
        className="absolute -top-2.5 -right-1.5 rounded-full bg-coral px-1.5 py-px text-[8px] font-semibold text-white shadow"
      >
        {tag}
      </span>
    </span>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[13px] font-semibold">{children}</p>
      {sub && <p className="text-muted">{sub}</p>}
    </div>
  );
}

export function Btn({ children, ghost = false }: { children: ReactNode; ghost?: boolean }) {
  return (
    <span
      className={`flex h-7 items-center justify-center gap-1 rounded-full px-3 font-medium ${
        ghost ? "border border-white/15 bg-white/5" : "bg-linear-to-r from-violet to-coral text-white"
      }`}
    >
      {children}
    </span>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex flex-col gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] p-2 ${className}`}>{children}</div>;
}

export function Radio({ title, sub, on = false }: { title: string; sub?: string; on?: boolean }) {
  return (
    <div className={`flex items-start gap-1.5 rounded-lg border p-1.5 ${on ? "border-coral/60 bg-coral/10" : "border-white/10"}`}>
      <span className={`mt-0.5 size-2.5 shrink-0 rounded-full border ${on ? "border-coral bg-coral" : "border-white/30"}`} />
      <span className="flex flex-col">
        <span className="font-medium">{title}</span>
        {sub && <span className="text-[9px] text-muted">{sub}</span>}
      </span>
    </div>
  );
}

export function Chip({ children, on = false }: { children: ReactNode; on?: boolean }) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[9px] ${
        on ? "bg-linear-to-r from-violet to-coral font-medium text-white" : "border border-white/15 text-muted"
      }`}
    >
      {children}
    </span>
  );
}

const TONES = {
  sunset: "from-[#ff9a5a] via-[#c2457a] to-[#3a1f5c]",
  sea: "from-[#7fd3ff] via-[#2f7fb8] to-[#123a5c]",
  cafe: "from-[#f3d2a2] via-[#a8673b] to-[#3b2216]",
  green: "from-[#b6f0a8] via-[#3f9a6b] to-[#173d30]",
  night: "from-[#5b4bd6] via-[#2a1f6b] to-[#0e0b24]",
};

/** A clip or video: a colored frame standing in for footage, with text on it if given. */
export function Footage({
  tone = "sunset",
  text,
  textAt = "top",
  className = "",
  children,
}: {
  tone?: keyof typeof TONES;
  text?: string;
  textAt?: "top" | "middle";
  className?: string;
  children?: ReactNode;
}) {
  return (
    <span className={`relative block overflow-hidden rounded-lg bg-linear-to-b ${TONES[tone]} ${className}`}>
      {text && (
        <span
          className={`absolute inset-x-1 text-center font-bold text-white [text-shadow:0_1px_2px_#000,0_0_1px_#000] ${
            textAt === "top" ? "top-[18%]" : "top-1/2 -translate-y-1/2"
          }`}
        >
          {text}
        </span>
      )}
      {children}
    </span>
  );
}

/** A text box from the options or the editor. */
export function TextBox({ value, hint, own = false }: { value?: string; hint?: string; own?: boolean }) {
  return (
    <span className="flex flex-col gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1.5">
      <span className={`rounded-md border border-white/15 bg-[#15151b] px-1.5 py-1 ${value ? "" : "text-white/30"}`}>{value || hint}</span>
      <span className="flex items-center gap-1 text-[8px] text-muted">
        <span>{value ? "0.0s–3.0s" : "left blank: it won’t be in your video."}</span>
        {own && <span className="rounded-full bg-violet/30 px-1 text-foreground">its own look</span>}
        <span className="ml-auto flex gap-1">
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-foreground">when it shows</span>
          <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-foreground">style &amp; place</span>
        </span>
      </span>
    </span>
  );
}

/** A progress bar. */
export function Bar({ value }: { value: number }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-white/10">
      <span className="block h-full rounded-full bg-linear-to-r from-violet to-coral" style={{ width: `${value}%` }} />
    </span>
  );
}
