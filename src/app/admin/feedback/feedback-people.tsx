import Link from "next/link";
import type { FeedbackPerson } from "@/lib/admin-data";
import { Badge, Card, when } from "../ui";

const RATING: Record<string, { label: string; tone: "good" | "bad" | "neutral" }> = {
  loved: { label: "loved it", tone: "good" },
  okay: { label: "okay", tone: "neutral" },
  not_quite: { label: "not quite", tone: "bad" },
};

/** Feedback by person, then by the video it was left on (playable), newest first. */
export function FeedbackPeople({ people, showPerson = true }: { people: FeedbackPerson[]; showPerson?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {people.map((p) => (
        <Card
          key={p.userId}
          title={showPerson ? p.name || p.email || "someone" : "feedback"}
          aside={
            showPerson ? (
              <Link href={`/admin/users/${p.userId}`} className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
                all their activity
              </Link>
            ) : undefined
          }
        >
          {showPerson && (
            <p className="text-xs text-muted">
              {p.email} · {p.projects} projects · {p.versions} versions · last active {when(p.lastActive)}
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {p.videos.map((v) => (
              <li key={`${v.projectId}:${v.version}`} className="grid gap-3 rounded-xl border border-white/10 p-3 sm:grid-cols-[8rem_1fr]">
                {v.url ? (
                  <video src={v.url} controls preload="none" playsInline className="aspect-[9/16] w-32 rounded-lg bg-black" />
                ) : (
                  <div className="flex aspect-[9/16] w-32 items-center justify-center rounded-lg bg-white/[0.04] p-2 text-center text-xs text-muted">
                    {v.deleted ? "project deleted" : "video unavailable"}
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm font-medium">
                    {v.projectName || (v.kind === "scratch" ? "from scratch" : "remake")} · version {v.version ?? "?"}
                    <span className="ml-2 text-xs font-normal text-muted">{v.kind}</span>
                  </p>
                  {v.request && <p className="text-xs text-muted">they asked for this version: “{v.request.slice(0, 200)}”</p>}
                  {v.items.map((i) => (
                    <div key={i.id} className="flex flex-col gap-1 rounded-lg bg-white/[0.04] p-2">
                      <div className="flex items-center gap-2 text-xs text-muted">
                        {i.rating && <Badge tone={RATING[i.rating]?.tone ?? "neutral"}>{RATING[i.rating]?.label ?? i.rating}</Badge>}
                        {when(i.createdAt)}
                      </div>
                      {i.message && <p className="text-sm whitespace-pre-wrap">{i.message}</p>}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
