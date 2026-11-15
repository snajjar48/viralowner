import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { recentVersions } from "@/lib/admin-data";
import { AdminShell, Card } from "../ui";
import { VersionTable } from "../version-table";

export const metadata: Metadata = { title: "admin · videos", robots: { index: false, follow: false } };

export default function AdminVideosPage() {
  return (
    <AdminShell title="videos">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Videos />
      </Suspense>
    </AdminShell>
  );
}

async function Videos() {
  await requireAdmin();
  const rows = await recentVersions(300);
  return (
    <Card title={`the latest ${rows.length} versions, from everyone`}>
      <VersionTable rows={rows} />
    </Card>
  );
}
