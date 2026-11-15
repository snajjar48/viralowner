import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { listWaitlist } from "@/lib/admin-data";
import { AdminShell } from "../ui";
import { WaitlistTable } from "./waitlist-table";

export const metadata: Metadata = { title: "admin · waitlist", robots: { index: false, follow: false } };

export default function AdminWaitlistPage() {
  return (
    <AdminShell title="waitlist">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Waitlist />
      </Suspense>
    </AdminShell>
  );
}

async function Waitlist() {
  await requireAdmin();
  return <WaitlistTable initial={await listWaitlist()} />;
}
