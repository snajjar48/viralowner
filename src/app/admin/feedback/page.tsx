import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { listFeedback } from "@/lib/admin-data";
import { AdminShell, Card } from "../ui";
import { FeedbackPeople } from "./feedback-people";

export const metadata: Metadata = { title: "admin · feedback", robots: { index: false, follow: false } };

export default function AdminFeedbackPage() {
  return (
    <AdminShell title="feedback">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Feedback />
      </Suspense>
    </AdminShell>
  );
}

async function Feedback() {
  await requireAdmin();
  const people = await listFeedback();
  const notes = people.reduce((n, p) => n + p.videos.reduce((m, v) => m + v.items.length, 0), 0);
  const count = (r: string) => people.reduce((n, p) => n + p.videos.reduce((m, v) => m + v.items.filter((i) => i.rating === r).length, 0), 0);
  return (
    <>
      <p className="text-sm text-muted">
        {notes} notes from {people.length} {people.length === 1 ? "person" : "people"} · loved it {count("loved")} · okay {count("okay")} · not quite{" "}
        {count("not_quite")}. left on the download page; each video plays here, and{" "}
        <Link href="/admin/users" className="underline underline-offset-4">
          each person’s page
        </Link>{" "}
        shows all their activity.
      </p>
      {people.length ? (
        <FeedbackPeople people={people} />
      ) : (
        <Card title="no feedback yet">
          <p className="text-sm text-muted">it shows up here as soon as someone sends it from the download page.</p>
        </Card>
      )}
    </>
  );
}
