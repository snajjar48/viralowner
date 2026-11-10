import type { Metadata } from "next";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "viralowner — dashboard",
  robots: { index: false, follow: false },
};

// Placeholder for the private site. Everything outside the public waitlist
// page is password-protected by src/proxy.ts.
export default function DashboardPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">You’re in.</h1>
      <p className="text-muted">This is the private area. Build the rest of viralowner here.</p>
      <SignOutButton />
    </div>
  );
}
