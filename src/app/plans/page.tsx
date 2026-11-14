import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth-shell";
import { getMembership, type Membership } from "@/lib/membership";
import { TIER_NAMES } from "@/lib/plan-format";
import { getPlans } from "@/lib/plans";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { ManageBillingButton } from "../dashboard/manage-billing-button";
import { PlansForm, type SavedCard } from "./plans-form";

export const metadata: Metadata = {
  title: "choose your plan",
  robots: { index: false, follow: false },
};

// Where a trial user (or anyone without a membership) subscribes, only by
// choosing a plan, accepting the terms and pressing the button.
export default function PlansPage() {
  return (
    <AuthShell title="choose your plan">
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Plans />
      </Suspense>
    </AuthShell>
  );
}

async function Plans() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/plans");

  const [membership, plans] = await Promise.all([getMembership(user.id), getPlans()]);

  if (membership.plan) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <p className="text-muted text-pretty">
          you’re on <span className="text-foreground">{TIER_NAMES[membership.plan.tier]}</span> ({membership.plan.interval}).
          to switch plans, update your card or cancel, open billing.
        </p>
        <ManageBillingButton />
        <Link href="/dashboard" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
          back to dashboard
        </Link>
      </div>
    );
  }
  if (!plans) {
    return <p className="text-center text-sm text-coral">plans aren’t set up yet. please check back soon.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-center text-muted text-pretty">{intro(membership)}</p>
      <PlansForm plans={plans} savedCard={await savedCard(user.id)} />
      <Link href="/dashboard" className="text-center text-sm text-muted underline underline-offset-4 hover:text-foreground">
        not now, back to dashboard
      </Link>
    </div>
  );
}

function intro(m: Membership) {
  if (m.trial === "available") return "your free video is still waiting for you. you can also pick a plan now.";
  if (m.trial === "used") return "you’ve used your free video. pick a plan to keep making videos and changes.";
  if (m.lapsedStatus === "canceled") return "your membership has ended. pick a plan to start again.";
  return "pick a plan to start making videos.";
}

/** The card saved at sign-up, shown so they know which card would be charged. */
async function savedCard(userId: string): Promise<SavedCard | null> {
  try {
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.stripe_customer_id) return null;
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(profile.stripe_customer_id, {
      expand: ["invoice_settings.default_payment_method"],
    });
    let pm = customer.deleted ? null : customer.invoice_settings?.default_payment_method;
    if (!pm || typeof pm === "string") {
      const cards = await stripe.paymentMethods.list({ customer: profile.stripe_customer_id, type: "card", limit: 1 });
      pm = cards.data[0] ?? null;
    }
    if (!pm || typeof pm === "string" || !pm.card) return null;
    return { brand: pm.card.brand, last4: pm.card.last4 };
  } catch (error) {
    console.error("Loading saved card failed:", error);
    return null;
  }
}
