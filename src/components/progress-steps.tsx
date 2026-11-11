import Link from "next/link";
import { CheckIcon } from "./icons";

const STEPS = ["inspo", "clips", "options"] as const;

/**
 * The 3-step indicator at the top of steps 1–3. Steps before the current one
 * are links (going back keeps everything; it's all saved).
 */
export function ProgressSteps({
  current,
  projectId,
}: {
  /** 1, 2 or 3. */
  current: 1 | 2 | 3;
  /** Needed to link back to earlier steps. */
  projectId?: string;
}) {
  const hrefs = projectId
    ? [`/projects/${projectId}/breakdown`, `/projects/${projectId}/clips`, `/projects/${projectId}/options`]
    : [];

  return (
    <nav aria-label="progress" className="w-full">
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => {
          const step = i + 1;
          const done = step < current;
          const active = step === current;
          const dot = (
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition ${
                active
                  ? "bg-linear-to-r from-violet to-coral text-white shadow-[0_6px_20px_-6px_rgba(246,49,101,0.8)]"
                  : done
                    ? "bg-white/15 text-foreground"
                    : "border border-white/15 text-muted"
              }`}
            >
              {done ? <CheckIcon className="size-3.5" /> : step}
            </span>
          );
          const content = (
            <>
              {dot}
              <span className={`text-sm ${active ? "text-foreground" : "text-muted"}`}>{label}</span>
            </>
          );
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              {done && hrefs[i] ? (
                <Link
                  href={hrefs[i]}
                  className="flex items-center gap-2 rounded-full pr-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-coral"
                >
                  {content}
                  <span className="sr-only">(done, go back)</span>
                </Link>
              ) : (
                <span className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
                  {content}
                </span>
              )}
              {step < STEPS.length && (
                <span
                  aria-hidden="true"
                  className={`h-px min-w-3 flex-1 ${done ? "bg-linear-to-r from-violet to-coral" : "bg-white/10"}`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
