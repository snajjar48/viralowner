import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "viralowner — create your account",
  robots: { index: false, follow: false },
};

export default function SignupPage() {
  return (
    <AuthShell title="Create your account">
      <SignupForm />
    </AuthShell>
  );
}
