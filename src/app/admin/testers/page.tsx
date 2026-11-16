import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { listTesters } from "@/lib/testers";
import { AdminShell, Card } from "../ui";
import { TestersManager } from "./testers-manager";

export const metadata: Metadata = { title: "admin · testers", robots: { index: false, follow: false } };

export default function AdminTestersPage() {
  return (
    <AdminShell title="testers">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Testers />
      </Suspense>
    </AdminShell>
  );
}

async function Testers() {
  await requireAdmin();
  const testers = await listTesters();
  return (
    <>
      <Card title="how it works">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          <li>add the tester’s email below.</li>
          <li>
            send them <span className="font-medium">www.viralowner.com/signup</span> and the site password (the site isn’t public yet).
          </li>
          <li>
            they sign up with that exact email and get full access for free: every video, change and “start from scratch”, no card.
          </li>
          <li>remove them any time and the free access stops right away.</li>
        </ol>
        <p className="text-xs text-muted">
          their videos, change requests and feedback show up like everyone else’s (users, videos and feedback pages), and the editor learns from them too.
        </p>
      </Card>
      {testers === null ? (
        <p className="text-sm text-coral">run the database migration (npm run db:migrate) to start adding testers.</p>
      ) : (
        <TestersManager initial={testers} />
      )}
    </>
  );
}
