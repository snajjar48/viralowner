import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BackgroundGlow } from "@/components/auth-layout";
import { createClient } from "@/lib/supabase/server";
import { ManageBillingButton } from "./manage-billing-button";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "viralowner — dashboard",
  robots: { index: false, follow: false },
};

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trialing: "Free trial",
  past_due: "Payment overdue: please update your card",
  incomplete: "Payment not completed",
  incomplete_expired: "Payment not completed",
  canceled: "Canceled",
  unpaid: "Unpaid",
  paused: "Paused",
};

// Requires the site password AND a signed-in account (see src/proxy.ts).
export default function DashboardPage() {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <BackgroundGlow />
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
    .select("first_name, plan, subscription_status, current_period_end, cancel_at_period_end")
    .eq("id", user.id)
    .maybeSingle();

  const status = profile?.subscription_status as string | null | undefined;
  const periodEnd = profile?.current_period_end
    ? new Date(profile.current_period_end).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">
        You’re in{profile?.first_name ? `, ${profile.first_name}` : ""}.
      </h1>
      <p className="text-muted">Signed in as {user.email}.</p>

      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-sm">
        {status ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-left">
            <dt className="text-muted">Plan</dt>
            <dd className="capitalize">{profile?.plan ?? "viralowner"}</dd>
            <dt className="text-muted">Status</dt>
            <dd>{STATUS_LABELS[status] ?? status}</dd>
            {periodEnd && (
              <>
                <dt className="text-muted">
                  {profile?.cancel_at_period_end ? "Ends" : "Renews"}
                </dt>
                <dd>{periodEnd}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-muted">No membership yet.</p>
        )}
      </div>

      {status && <ManageBillingButton />}
    </>
  );
}
