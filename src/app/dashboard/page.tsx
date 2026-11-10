import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "viralowner — dashboard",
  robots: { index: false, follow: false },
};

// Requires the site password AND a signed-in account (see src/proxy.ts).
export default function DashboardPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Account />
      </Suspense>
      <SignOutButton />
    </div>
  );
}

async function Account() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, has_payment_method")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        You’re in{profile?.first_name ? `, ${profile.first_name}` : ""}.
      </h1>
      <p className="text-muted">Signed in as {user.email}.</p>
      <p className="text-sm text-muted">
        {profile?.has_payment_method ? "Payment method on file." : "No payment method on file yet."}
      </p>
    </>
  );
}
