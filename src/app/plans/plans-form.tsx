"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { buttonClass, FormError } from "@/components/form";
import { ArrowRightIcon, LockIcon } from "@/components/icons";
import { PlanPicker, type Choice } from "@/components/plan-picker";
import { baseOptions, paymentElementOptions, stripePromise } from "@/components/stripe-config";
import { chargeSummary, findPlan, formatPrice, TIER_NAMES, type Interval, type Plan, type Tier } from "@/lib/plan-format";

export interface SavedCard {
  brand: string;
  last4: string;
}

export function PlansForm({ plans, savedCard }: { plans: Plan[]; savedCard: SavedCard | null }) {
  const [tier, setTier] = useState<Tier>("basic");
  const [interval, setInterval] = useState<Interval>("monthly");
  const plan = findPlan(plans, tier, interval);

  if (!stripePromise || !plan) {
    return <p className="text-center text-sm text-coral">payments aren’t set up yet. please check back soon.</p>;
  }
  return (
    <Elements
      stripe={stripePromise}
      options={{ ...baseOptions, mode: "subscription", amount: plan.amount, currency: plan.currency, allowedPaymentMethodTypes: ["card"] }}
    >
      <Fields
        plans={plans}
        plan={plan}
        interval={interval}
        onTier={setTier}
        onInterval={setInterval}
        savedCard={savedCard}
      />
    </Elements>
  );
}

function Fields({
  plans,
  plan,
  interval,
  onTier,
  onInterval,
  savedCard,
}: {
  plans: Plan[];
  plan: Plan;
  interval: Interval;
  onTier: (t: Tier) => void;
  onInterval: (i: Interval) => void;
  savedCard: SavedCard | null;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const router = useRouter();
  const [newCard, setNewCard] = useState(!savedCard);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function finish(subscriptionId: string) {
    await fetch("/api/billing/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscriptionId }),
    }).catch(() => null);
    router.push("/dashboard");
    router.refresh();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;
    if (!accepted) return setError("Please tick the box to accept the terms.");
    setSubmitting(true);
    setError("");
    try {
      if (newCard) {
        const { error: cardError } = await elements.submit();
        if (cardError) return setError(cardError.message ?? "Please check your card details.");
      }
      const res = await fetch("/api/billing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier: plan.tier, interval: plan.interval, acceptTerms: true, newCard }),
      });
      const result = await res.json().catch(() => ({}));
      if (result.needsCard) {
        setNewCard(true);
        return setError("Please enter a card.");
      }
      if (!res.ok) return setError(result.error ?? "Something went wrong. Please try again.");
      if (result.status === "active") return await finish(result.subscriptionId);

      const clientSecret: string = result.clientSecret;
      if (newCard) {
        const { error: payError } = await stripe.confirmPayment({
          elements,
          clientSecret,
          redirect: "if_required",
          confirmParams: { return_url: `${window.location.origin}/dashboard` },
        });
        if (payError) return setError(`The payment didn’t go through: ${payError.message ?? "it was declined."}`);
        return await finish(result.subscriptionId);
      }

      // Saved card: it may need the bank's check (3-D Secure), or be declined.
      const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
      if (paymentIntent?.status === "requires_action") {
        const { error: actionError } = await stripe.handleNextAction({ clientSecret });
        if (actionError) return setError(`Your bank didn’t approve the payment: ${actionError.message ?? "please try again."}`);
        return await finish(result.subscriptionId);
      }
      if (paymentIntent?.status === "succeeded" || paymentIntent?.status === "processing") {
        return await finish(result.subscriptionId);
      }
      setNewCard(true);
      setError(
        `Your saved card was declined${
          paymentIntent?.last_payment_error?.message ? `: ${paymentIntent.last_payment_error.message}` : "."
        } Please enter a different card. You haven’t been charged.`,
      );
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <PlanPicker
        plans={plans}
        choice={plan.tier}
        interval={interval}
        onChoice={(c: Choice) => c !== "trial" && onTier(c)}
        onInterval={onInterval}
        includeTrial={false}
        disabled={submitting}
      />

      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Card</p>
        {newCard ? (
          <>
            <PaymentElement options={paymentElementOptions} />
            {savedCard && (
              <button
                type="button"
                onClick={() => setNewCard(false)}
                className="self-start text-sm text-muted underline underline-offset-4 hover:text-foreground"
              >
                use my saved {savedCard.brand} ending in {savedCard.last4}
              </button>
            )}
          </>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm">
            <span className="capitalize">
              {savedCard?.brand} •••• {savedCard?.last4}
            </span>
            <button
              type="button"
              onClick={() => setNewCard(true)}
              className="text-muted underline underline-offset-4 hover:text-foreground"
            >
              use a different card
            </button>
          </div>
        )}
      </div>

      <p className="flex items-start gap-2 text-sm text-muted text-pretty">
        <LockIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>{chargeSummary(plan)}</span>
      </p>

      <label className="flex cursor-pointer items-start gap-3 text-sm text-muted">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 cursor-pointer accent-violet"
        />
        <span className="text-pretty">
          I agree to the{" "}
          <Link href="/terms" target="_blank" className="text-foreground underline underline-offset-4">
            terms and conditions
          </Link>{" "}
          and want to subscribe to {TIER_NAMES[plan.tier]} for {formatPrice(plan)}, renewing until I cancel.
        </span>
      </label>

      <button type="submit" disabled={submitting || !stripe || !accepted} className={`${buttonClass} group`}>
        <span className="inline-flex items-center justify-center gap-2">
          {submitting ? "Subscribing…" : `Subscribe to ${TIER_NAMES[plan.tier]} · ${formatPrice(plan)}`}
          {!submitting && <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />}
        </span>
      </button>
      <FormError id="plans-error" message={error} />
    </form>
  );
}
