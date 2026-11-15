import type { Metadata } from "next";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-auth";
import { listUsers } from "@/lib/admin-data";
import { AdminShell } from "../ui";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "admin · users", robots: { index: false, follow: false } };

export default function AdminUsersPage() {
  return (
    <AdminShell title="users">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Users />
      </Suspense>
    </AdminShell>
  );
}

async function Users() {
  await requireAdmin();
  const users = await listUsers();
  return (
    <UsersTable
      users={users.map((u) => ({
        id: u.id,
        name: `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(),
        email: u.email ?? "",
        plan: u.plan,
        status: u.subscription_status,
        joined: u.created_at,
        lastSignIn: u.lastSignIn,
        lastActive: u.lastActive,
        recent: u.recent,
        projects: u.projects,
        videos: u.videos,
        failed: u.failed,
        bytes: u.bytes,
      }))}
    />
  );
}
