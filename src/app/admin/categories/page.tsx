import type { Metadata } from "next";
import { Suspense } from "react";
import { categoryStats } from "@/lib/admin-data";
import { requireAdmin } from "@/lib/admin-auth";
import { VIDEO_CATEGORIES } from "@/lib/categories";
import { categoryLessons } from "@/lib/lessons";
import { workerHealth } from "@/lib/worker";
import { AdminShell, Badge, Card } from "../ui";

export const metadata: Metadata = { title: "admin · categories", robots: { index: false, follow: false } };

export default function AdminCategoriesPage() {
  return (
    <AdminShell title="categories">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Categories />
      </Suspense>
    </AdminShell>
  );
}

async function Categories() {
  await requireAdmin();
  const [stats, lessons, health] = await Promise.all([categoryStats(), categoryLessons(), workerHealth().catch(() => null)]);
  return (
    <>
      <p className="max-w-3xl text-sm text-muted">
        people pick one of these when they start a video. each video is analyzed and made with its category’s playbook first,
        plus the lessons learned (once a day) from the change requests, notes and feedback on that category’s videos.
        {stats === null && " run the database migration (npm run db:migrate) to start saving categories."}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {VIDEO_CATEGORIES.map((c) => {
          const st = stats?.[c.id];
          const set = lessons[c.id];
          const size = health?.playbooks?.[c.id];
          return (
            <Card
              key={c.id}
              title={c.label}
              aside={
                size === undefined ? (
                  <Badge tone="neutral">playbook: ?</Badge>
                ) : size > 0 ? (
                  <Badge tone="good">playbook ready</Badge>
                ) : (
                  <Badge tone="warn">no playbook yet</Badge>
                )
              }
            >
              <ul className="grid grid-cols-2 gap-1.5 text-sm sm:grid-cols-4">
                <li className="flex flex-col"><span className="text-xs text-muted">videos</span><span className="tabular-nums">{st?.projects ?? 0}</span></li>
                <li className="flex flex-col"><span className="text-xs text-muted">last 30 days</span><span className="tabular-nums">{st?.projects30 ?? 0}</span></li>
                <li className="flex flex-col"><span className="text-xs text-muted">versions made</span><span className="tabular-nums">{st?.versions ?? 0}</span></li>
                <li className="flex flex-col"><span className="text-xs text-muted">change requests</span><span className="tabular-nums">{st?.requests ?? 0}</span></li>
              </ul>
              {set ? (
                <>
                  <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
                    {set.lessons.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ol>
                  <p className="text-xs text-muted">
                    learned from {set.count} change requests, notes and feedback · {new Date(set.createdAt).toLocaleDateString()}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">no lessons yet: they start once this category has at least 5 requests, notes or feedback.</p>
              )}
            </Card>
          );
        })}
      </div>
      {stats?.none && (
        <p className="text-xs text-muted">{stats.none.projects} earlier videos have no category (they use every playbook, picked by what’s in the video).</p>
      )}
    </>
  );
}
