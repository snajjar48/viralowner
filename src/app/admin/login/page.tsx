import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { adminAccount, adminSession } from "@/lib/admin-auth";
import { AdminLoginForm } from "./login-form";

export const metadata: Metadata = { title: "admin", robots: { index: false, follow: false } };

export default function AdminLoginPage() {
  return (
    <AuthShell title="admin">
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Gate />
      </Suspense>
    </AuthShell>
  );
}

async function Gate() {
  // Anyone but the owner sees nothing here at all.
  if (!(await adminAccount())) notFound();
  if (await adminSession()) redirect("/admin");
  return <AdminLoginForm />;
}
