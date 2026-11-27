import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell } from "@/components/flow-shell";
import { EMPTY_BUSINESS, getBusiness } from "@/lib/business";
import { onboardingOf } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";
import { WelcomeSteps } from "./welcome-steps";

export const metadata: Metadata = {
  title: "welcome",
  robots: { index: false, follow: false },
};

// The one-time setup new accounts see before their first video (the dashboard sends them here).
export default function WelcomePage() {
  return (
    <FlowShell>
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Welcome />
      </Suspense>
    </FlowShell>
  );
}

async function Welcome() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/welcome");
  const [{ data: account }, business] = await Promise.all([
    supabase.from("profiles").select("first_name").eq("id", user.id).maybeSingle(),
    getBusiness(user.id),
  ]);
  const firstName = typeof account?.first_name === "string" ? account.first_name.trim() : "";
  return <WelcomeSteps firstName={firstName} category={onboardingOf(user).category} business={business ?? EMPTY_BUSINESS} />;
}
