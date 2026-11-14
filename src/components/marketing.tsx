import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BackgroundGlow } from "./auth-layout";
import { MarketingNav } from "./marketing-nav";
import { JsonLd } from "./structured-data";
import { WaitlistForm } from "./waitlist-form";

/**
 * The switch for launch day: while false, every button on the public pages is the waitlist; set
 * NEXT_PUBLIC_SIGNUPS_OPEN=true (and take sign-up out from behind the site password) to send
 * them all to sign-up instead.
 */
export const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";

/** The main button's words and where it goes (the join section below, while it's a waitlist). */
export const MAIN_CTA = SIGNUPS_OPEN
  ? { href: "/signup", label: "get started" }
  : { href: "#join", label: "join the waitlist" };

/** Page frame for the public site. `minimal` (ad landing pages): just the logo, no links away. */
export function MarketingShell({ children, minimal = false }: { children: ReactNode; minimal?: boolean }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col overflow-x-clip">
      <BackgroundGlow />
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="viralowner home" className="shrink-0">
            <Image src="/logo.svg" alt="viralowner" width={1458} height={418} preload className="h-7 w-auto" />
          </Link>
          {minimal ? (
            <a
              href="#join"
              className="inline-flex h-10 items-center rounded-full bg-white px-4 text-sm font-medium text-black transition hover:bg-white/90"
            >
              {MAIN_CTA.label}
            </a>
          ) : (
            <MarketingNav cta={MAIN_CTA} />
          )}
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Footer minimal={minimal} />
    </div>
  );
}

function Footer({ minimal }: { minimal: boolean }) {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="flex max-w-xs flex-col gap-3">
          <Image src="/logo.svg" alt="viralowner" width={1458} height={418} className="h-7 w-auto self-start" />
          <p className="text-sm text-pretty text-muted">
            your clips, edited like the videos that went viral. made for business owners and creators.
          </p>
        </div>
        {!minimal && (
          <nav aria-label="footer" className="grid grid-cols-2 gap-x-12 gap-y-2 text-sm sm:grid-cols-3">
            <Link href="/what-is-viralowner" className="text-muted hover:text-foreground">
              how it works
            </Link>
            <Link href="/why-viralowner" className="text-muted hover:text-foreground">
              why viralowner
            </Link>
            <Link href="/pricing" className="text-muted hover:text-foreground">
              pricing
            </Link>
            <Link href="/terms" className="text-muted hover:text-foreground">
              terms
            </Link>
            <a href="mailto:hello@viralowner.com" className="text-muted hover:text-foreground">
              contact
            </a>
          </nav>
        )}
      </div>
      <p className="mx-auto w-full max-w-6xl px-4 pb-10 text-xs text-muted/70 sm:px-6">
        © viralowner · <a href="mailto:hello@viralowner.com">hello@viralowner.com</a>
      </p>
    </footer>
  );
}

/** The main ask: the waitlist form for now, a sign-up button once sign-ups open. */
export function JoinCta({ id, source, center = false }: { id: string; source: string; center?: boolean }) {
  if (SIGNUPS_OPEN) {
    return (
      <div className={`flex flex-col gap-3 ${center ? "items-center" : "items-start"}`}>
        <Link
          href="/signup"
          className="inline-flex h-14 items-center rounded-full bg-linear-to-r from-violet to-coral px-8 text-lg font-medium text-white shadow-[0_18px_50px_-20px] shadow-coral/70 transition hover:brightness-110"
        >
          get started
        </Link>
        <p className="text-sm text-muted">your first video is free. no charge unless you pick a plan.</p>
      </div>
    );
  }
  return (
    <div className={`flex w-full max-w-md flex-col gap-1 ${center ? "mx-auto" : ""}`}>
      <WaitlistForm id={id} source={source} />
      <p className={`-mt-2 text-xs text-muted ${center ? "text-center" : ""}`}>
        early spots get their first video free. no spam, ever.
      </p>
    </div>
  );
}

/** The closing section every page ends with (the header's button scrolls here). */
export function JoinSection({ source, title, body }: { source: string; title?: ReactNode; body?: ReactNode }) {
  return (
    <section id="join" className="scroll-mt-24 px-4 py-20 sm:px-6 sm:py-28">
      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-6 overflow-hidden rounded-[2rem] border border-white/10 bg-linear-to-br from-violet/25 via-white/[0.03] to-coral/20 px-6 py-14 text-center sm:px-12 sm:py-20">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-5xl">
          {title ?? "your next video, without the editing."}
        </h2>
        <p className="max-w-xl text-pretty text-muted sm:text-lg">
          {body ?? "send us your clips and a video you love. you’ll get it back edited, captioned and ready to post."}
        </p>
        <div className="w-full">
          <JoinCta id={`join-${source}`} source={`${source}-bottom`} center />
        </div>
      </div>
    </section>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 px-4 py-16 sm:px-6 sm:py-24 ${className}`}>
      <div className="mx-auto flex max-w-6xl flex-col gap-10 sm:gap-14">
        <div className="flex max-w-2xl flex-col gap-3">
          {eyebrow && (
            <p className="text-sm font-medium bg-linear-to-r from-violet to-coral bg-clip-text text-transparent">{eyebrow}</p>
          )}
          <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
          {intro && <p className="text-pretty text-muted sm:text-lg">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function Steps({ steps }: { steps: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-3">
      {steps.map((s, i) => (
        <li key={s.title} className="flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <span className="flex size-9 items-center justify-center rounded-full bg-linear-to-br from-violet to-coral text-sm font-semibold text-white">
            {i + 1}
          </span>
          <h3 className="text-lg font-semibold">{s.title}</h3>
          <p className="text-sm text-pretty text-muted">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function FeatureGrid({ items }: { items: { title: string; body: ReactNode; icon?: ReactNode }[] }) {
  return (
    <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <li key={f.title} className="flex flex-col gap-2">
          {f.icon && <span className="mb-1 flex size-10 items-center justify-center rounded-2xl bg-white/[0.07] text-coral">{f.icon}</span>}
          <h3 className="font-semibold">{f.title}</h3>
          <p className="text-sm text-pretty text-muted">{f.body}</p>
        </li>
      ))}
    </ul>
  );
}

/** Questions and answers, plus their FAQPage structured data (pass `schema={false}` on pages search shouldn't read). */
export function Faq({ items, schema = true }: { items: { q: string; a: string }[]; schema?: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-white/10 border-y border-white/10">
      {schema && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: items.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          }}
        />
      )}
      {items.map((f) => (
        <details key={f.q} className="group py-1">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left font-medium focus-visible:outline-2 focus-visible:outline-coral [&::-webkit-details-marker]:hidden">
            {f.q}
            <span aria-hidden="true" className="text-xl leading-none text-muted transition group-open:rotate-45">
              +
            </span>
          </summary>
          <div className="pb-5 text-sm leading-relaxed text-pretty text-muted">{f.a}</div>
        </details>
      ))}
    </div>
  );
}

export function Check({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <svg viewBox="0 0 20 20" aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-coral" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-pretty">{children}</span>
    </li>
  );
}

/**
 * The idea in one picture, drawn (no real footage): a viral video, your clips, and your version
 * with its text and captions in place.
 */
export function HeroVisual() {
  return (
    <div aria-hidden="true" className="relative mx-auto h-[30rem] w-full max-w-[26rem] sm:h-[34rem]">
      {/* the viral video */}
      <Phone className="absolute top-8 left-0 w-[42%] -rotate-6 opacity-80" tone="from-sky-500/50 via-violet/40 to-fuchsia-500/40">
        <span className="absolute inset-x-2 top-[22%] text-center text-[9px] leading-tight font-semibold text-white drop-shadow sm:text-[10px]">
          when the line is out the door at 7am
        </span>
        <Tag className="absolute bottom-3 left-1/2 -translate-x-1/2">the viral one</Tag>
      </Phone>
      {/* your clips */}
      <div className="absolute bottom-6 left-[2%] flex w-[40%] rotate-3 flex-col gap-1.5 rounded-2xl border border-white/10 bg-[#141419]/90 p-2.5 shadow-xl backdrop-blur">
        <span className="text-[10px] font-medium text-muted">your clips</span>
        <div className="grid grid-cols-3 gap-1">
          {["from-amber-400/60 to-rose-500/50", "from-emerald-400/50 to-cyan-500/40", "from-fuchsia-500/50 to-orange-400/50"].map((g) => (
            <span key={g} className={`aspect-[9/16] rounded-md bg-linear-to-br ${g}`} />
          ))}
        </div>
      </div>
      {/* your version */}
      <Phone className="absolute top-0 right-0 w-[58%] rotate-3 shadow-[0_40px_120px_-30px] shadow-coral/50" tone="from-amber-400/60 via-rose-500/50 to-violet/60" main>
        <span className="absolute inset-x-3 top-[20%] text-center text-[11px] leading-tight font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:text-xs">
          pov: the line is out the door and it’s only 7am
        </span>
        <span className="absolute inset-x-0 top-[62%] text-center text-sm font-extrabold tracking-tight text-white uppercase drop-shadow-[0_2px_0_rgba(0,0,0,0.9)] sm:text-base">
          one more <span className="rounded bg-coral px-1">oat</span> latte
        </span>
        <span className="absolute right-3 bottom-4 left-3 flex items-center justify-between">
          <Tag>your version</Tag>
          <span className="rounded-full bg-emerald-400/90 px-2 py-0.5 text-[9px] font-semibold text-black">ready to post</span>
        </span>
      </Phone>
      <span className="absolute top-[46%] left-[38%] z-10 flex size-10 items-center justify-center rounded-full bg-white text-black shadow-lg">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </span>
    </div>
  );
}

function Phone({ children, className, tone, main }: { children: ReactNode; className: string; tone: string; main?: boolean }) {
  return (
    <div className={`rounded-[1.6rem] border border-white/15 bg-black p-1.5 ${className}`}>
      <div className={`relative aspect-[9/19] overflow-hidden rounded-[1.25rem] bg-linear-to-br ${tone}`}>
        <span className="absolute inset-0 bg-[radial-gradient(circle_at_30%_35%,rgba(255,255,255,0.25),transparent_45%)]" />
        <span className="absolute top-1.5 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-black/50" />
        {main && (
          <span className="absolute top-[38%] right-2 flex flex-col items-center gap-2 opacity-70">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-4 rounded-full bg-white/70" />
            ))}
          </span>
        )}
        {children}
      </div>
    </div>
  );
}

function Tag({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`rounded-full bg-black/60 px-2 py-0.5 text-[9px] font-medium whitespace-nowrap text-white backdrop-blur ${className}`}>
      {children}
    </span>
  );
}
