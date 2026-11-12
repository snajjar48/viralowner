import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = {
  title: "viralowner — choose a new password",
  robots: { index: false, follow: false },
};

// Reached from the reset email's link, which signs the user in first
// (/auth/confirm). Requires a signed-in account (src/proxy.ts).
export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password">
      <ResetForm />
    </AuthShell>
  );
}
