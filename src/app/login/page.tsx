import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "viralowner — log in",
  robots: { index: false, follow: false },
};

export default function LoginPage() {
  return (
    <AuthShell title="Log in">
      {/* The form reads ?next= and ?error= from the URL, so it renders per request. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
