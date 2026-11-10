"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { buttonClass, Field, FormError, inputClass } from "@/components/form";
import { ArrowRightIcon, CheckIcon, LockIcon } from "@/components/icons";
import { PasswordInput, StrengthMeter } from "@/components/password-input";
import { COUNTRIES } from "@/lib/countries";
import { formatMoney, yearlySavingsPercent, type Plan, type PlanId } from "@/lib/plan-format";
import { PASSWORD_MAX, PASSWORD_MIN, type BillingAddress } from "@/lib/signup-validation";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const baseOptions = {
  fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap" }],
  appearance: {
    theme: "night",
    variables: {
      colorPrimary: "#7b2ff7",
      colorBackground: "#18181d",
      colorText: "#f5f5f7",
      colorTextSecondary: "#a1a1aa",
      colorTextPlaceholder: "#71717a",
      colorDanger: "#ff3d6e",
      fontFamily: "Geist, system-ui, sans-serif",
      fontSizeBase: "16px",
      borderRadius: "12px",
    },
    rules: {
      ".Input": { border: "1px solid rgba(255, 255, 255, 0.15)", boxShadow: "none" },
      ".Input:focus": { border: "1px solid rgba(255, 255, 255, 0.4)", boxShadow: "none" },
      ".Label": { color: "#a1a1aa", fontSize: "14px" },
    },
  },
} satisfies Partial<StripeElementsOptions>;

// Name, email, phone and address come from our own fields.
const paymentElementOptions = {
  fields: {
    billingDetails: { name: "never", email: "never", phone: "never", address: "never" },
  },
  wallets: { applePay: "never", googlePay: "never", link: "never" },
} as const;

export function SignupForm({ plans }: { plans: Plan[] | null }) {
  const [planId, setPlanId] = useState<PlanId>("yearly");
  const plan = plans?.find((p) => p.id === planId);
  const options = useMemo<StripeElementsOptions | null>(
    () =>
      plan
        ? {
            ...baseOptions,
            mode: "subscription",
            amount: plan.amount,
            currency: plan.currency,
            allowedPaymentMethodTypes: ["card"],
          }
        : null,
    [plan],
  );

  if (!stripePromise || !plans || !plan || !options) {
    return (
      <p className="text-center text-sm text-coral">
        Sign-ups aren’t open yet: payments or plans aren’t set up.
      </p>
    );
  }
  return (
    <Elements stripe={stripePromise} options={options}>
      <SignupFields plans={plans} plan={plan} onPlanChange={setPlanId} />
    </Elements>
  );
}

type Details = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: BillingAddress;
};

function readForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const get = (name: string) => String(data.get(name) ?? "").trim();
  const details: Details = {
    firstName: get("firstName"),
    lastName: get("lastName"),
    phone: get("phone"),
    email: get("email"),
    address: {
      line1: get("line1"),
      line2: get("line2"),
      city: get("city"),
      state: get("state"),
      postalCode: get("postalCode"),
      country: get("country"),
    },
  };
  return {
    details,
    password: String(data.get("password") ?? ""),
    confirmPassword: String(data.get("confirmPassword") ?? ""),
    acceptTerms: data.get("acceptTerms") === "on",
    website: get("website"),
  };
}

function SignupFields({
  plans,
  plan,
  onPlanChange,
}: {
  plans: Plan[];
  plan: Plan;
  onPlanChange: (id: PlanId) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  // Set to the address we emailed when confirmation is required.
  const [checkEmail, setCheckEmail] = useState("");
  // Once the account exists, only the card can be retried.
  const account = useRef<{
    clientSecret: string;
    subscriptionId: string;
    needsEmailConfirmation: boolean;
    details: Details;
  }>(null);
  const [accountCreated, setAccountCreated] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [cardLoadError, setCardLoadError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stripe || !elements) return;

    const values = readForm(event.currentTarget);
    if (!account.current) {
      if (values.password !== values.confirmPassword) {
        setError("Passwords don’t match.");
        return;
      }
      if (!values.acceptTerms) {
        setError("Please accept the terms and conditions.");
        return;
      }
    }

    setSubmitting(true);
    setError("");

    try {
      // Stripe requires validating the card fields before any other async work.
      const { error: cardError } = await elements.submit();
      if (cardError) {
        setError(cardError.message ?? "Please check your card details.");
        return;
      }

      if (!account.current) {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...values.details,
            password: values.password,
            confirmPassword: values.confirmPassword,
            acceptTerms: values.acceptTerms,
            plan: plan.id,
            website: values.website,
          }),
        });
        const result = await res.json().catch(() => ({}));
        if (!res.ok || !result.clientSecret) {
          setError(result.error ?? "Something went wrong. Please try again.");
          return;
        }
        account.current = {
          clientSecret: result.clientSecret,
          subscriptionId: result.subscriptionId,
          needsEmailConfirmation: Boolean(result.needsEmailConfirmation),
          details: values.details,
        };
        setAccountCreated(true);
      }

      const { clientSecret, subscriptionId, needsEmailConfirmation, details } = account.current;
      const { error: confirmError } = await stripe.confirmPayment({
        elements,
        clientSecret,
        redirect: "if_required",
        confirmParams: {
          return_url: `${window.location.origin}/dashboard`,
          payment_method_data: {
            billing_details: {
              name: `${details.firstName} ${details.lastName}`,
              email: details.email,
              phone: details.phone,
              address: {
                line1: details.address.line1,
                line2: details.address.line2,
                city: details.address.city,
                state: details.address.state,
                postal_code: details.address.postalCode,
                country: details.address.country,
              },
            },
          },
        },
      });

      if (confirmError) {
        setError(
          `Your account is set up, but the payment didn’t go through: ${
            confirmError.message ?? "it was declined."
          } Please try another card.`,
        );
        return;
      }

      // Update the account right away (Stripe's webhook also does this).
      await fetch("/api/billing/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId }),
      });

      if (needsEmailConfirmation) {
        setCheckEmail(details.email);
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkEmail) {
    return (
      <div className="flex flex-col items-center gap-4 py-6 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-linear-to-r from-violet to-coral">
          <CheckIcon className="size-7 text-white" />
        </span>
        <p className="text-xl font-semibold">Check your email.</p>
        <p className="text-muted text-pretty">
          We sent a link to <span className="text-foreground">{checkEmail}</span>. Click it to
          confirm your account and you’re in.
        </p>
      </div>
    );
  }

  const locked = accountCreated;
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;
  const matches = confirmPassword.length > 0 && confirmPassword === password;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-10">
      {/* Honeypot: hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Step n={1} title="Choose your plan" disabled={submitting || locked}>
        <PlanPicker plans={plans} selected={plan.id} onChange={onPlanChange} />
      </Step>

      <Step n={2} title="About you" disabled={submitting && !locked}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName">
            <input id="firstName" name="firstName" required maxLength={50} autoComplete="given-name" readOnly={locked} className={inputClass} />
          </Field>
          <Field label="Last name" htmlFor="lastName">
            <input id="lastName" name="lastName" required maxLength={50} autoComplete="family-name" readOnly={locked} className={inputClass} />
          </Field>
        </div>
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" readOnly={locked} className={inputClass} />
        </Field>
        <Field label="Phone number" htmlFor="phone">
          <input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="+1 555 123 4567" pattern="^\+?[\d\s().\-]{10,20}$" readOnly={locked} className={inputClass} />
        </Field>
      </Step>

      <Step n={3} title="Create a password" disabled={submitting && !locked}>
        <Field label="Password" htmlFor="password">
          <PasswordInput id="password" name="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" placeholder={`At least ${PASSWORD_MIN} characters`} readOnly={locked} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <StrengthMeter value={password} />
        <Field label="Confirm password" htmlFor="confirmPassword">
          <PasswordInput id="confirmPassword" name="confirmPassword" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" readOnly={locked} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} aria-invalid={mismatch || undefined} />
        </Field>
        <p aria-live="polite" className={`-mt-2 min-h-4 text-xs ${mismatch ? "text-coral" : "text-muted"}`}>
          {mismatch && "Passwords don’t match yet."}
          {matches && (
            <span className="inline-flex items-center gap-1">
              <CheckIcon className="size-3.5 text-violet" /> Passwords match
            </span>
          )}
        </p>
      </Step>

      <Step n={4} title="Billing address" disabled={submitting && !locked}>
        <Field label="Country" htmlFor="country">
          <div className="relative">
            <select id="country" name="country" required defaultValue="US" disabled={locked} className={`${inputClass} cursor-pointer appearance-none pr-10`}>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code} className="bg-background">
                  {name}
                </option>
              ))}
            </select>
            <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted" fill="currentColor">
              <path d="M5.2 7.5a.75.75 0 0 1 1.06 0L10 11.2l3.74-3.7a.75.75 0 1 1 1.06 1.06l-4.27 4.24a.75.75 0 0 1-1.06 0L5.2 8.56a.75.75 0 0 1 0-1.06z" />
            </svg>
          </div>
        </Field>
        <Field label="Street address" htmlFor="line1">
          <input id="line1" name="line1" required maxLength={200} autoComplete="address-line1" readOnly={locked} className={inputClass} />
        </Field>
        <Field label="Apartment, suite, etc. (optional)" htmlFor="line2">
          <input id="line2" name="line2" maxLength={200} autoComplete="address-line2" readOnly={locked} className={inputClass} />
        </Field>
        <Field label="City" htmlFor="city">
          <input id="city" name="city" required maxLength={100} autoComplete="address-level2" readOnly={locked} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="State / region" htmlFor="state">
            <input id="state" name="state" maxLength={100} autoComplete="address-level1" readOnly={locked} className={inputClass} />
          </Field>
          <Field label="ZIP / postal code" htmlFor="postalCode">
            <input id="postalCode" name="postalCode" required maxLength={20} autoComplete="postal-code" readOnly={locked} className={inputClass} />
          </Field>
        </div>
      </Step>

      <Step n={5} title="Payment">
        <PaymentElement
          options={paymentElementOptions}
          onLoadError={(event) => {
            console.error("Stripe card field failed to load:", event.error);
            setCardLoadError(event.error.message ?? "The card field couldn’t load.");
          }}
        />
        {cardLoadError && (
          <p role="alert" className="text-sm text-coral">
            Couldn’t load the card field: {cardLoadError} Please refresh the page.
          </p>
        )}
        <p className="flex items-center gap-2 text-xs text-muted">
          <LockIcon className="size-3.5 shrink-0" />
          You’ll be charged {formatMoney(plan.amount, plan.currency)} today, then every{" "}
          {plan.id === "monthly" ? "month" : "year"} until you cancel. Cancel anytime.
        </p>
      </Step>

      <div className="flex flex-col gap-5">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-muted">
          <input
            name="acceptTerms"
            type="checkbox"
            required
            disabled={locked}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-violet"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" target="_blank" className="text-foreground underline underline-offset-4">
              terms and conditions
            </Link>
            .
          </span>
        </label>

        <button type="submit" disabled={submitting || !stripe} className={`${buttonClass} group`}>
          <span className="inline-flex items-center justify-center gap-2">
            {submitting
              ? "Setting up your account…"
              : locked
                ? "Try payment again"
                : `Start my membership · ${formatMoney(plan.amount, plan.currency)}/${
                    plan.id === "monthly" ? "mo" : "yr"
                  }`}
            {!submitting && (
              <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
            )}
          </span>
        </button>
        <FormError id="signup-error" message={error} />

        <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs text-muted">
          <li className="inline-flex items-center gap-1.5">
            <LockIcon className="size-3.5" /> Secured by Stripe
          </li>
          <li className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-3.5" /> Cancel anytime
          </li>
          <li className="inline-flex items-center gap-1.5">
            <CheckIcon className="size-3.5" /> Your card never touches our servers
          </li>
        </ul>
      </div>
    </form>
  );
}

function Step({
  n,
  title,
  disabled,
  children,
}: {
  n: number;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4" disabled={disabled}>
      <legend className="mb-5 flex items-center gap-3 text-sm font-medium">
        <span className="flex size-6 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs text-foreground/80">
          {n}
        </span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function PlanPicker({
  plans,
  selected,
  onChange,
}: {
  plans: Plan[];
  selected: PlanId;
  onChange: (id: PlanId) => void;
}) {
  const monthly = plans.find((p) => p.id === "monthly");
  const yearly = plans.find((p) => p.id === "yearly");
  const savings = monthly && yearly ? yearlySavingsPercent(monthly, yearly) : 0;

  return (
    <div role="radiogroup" aria-label="Plan" className="grid gap-3 sm:grid-cols-2">
      {plans.map((p) => {
        const active = p.id === selected;
        const isYearly = p.id === "yearly";
        return (
          <label
            key={p.id}
            className={`relative flex cursor-pointer flex-col gap-1 rounded-2xl border p-4 transition has-[:disabled]:cursor-default ${
              active
                ? "border-transparent bg-white/[0.06] ring-2 ring-violet"
                : "border-white/15 bg-white/[0.03] hover:border-white/30"
            }`}
          >
            <input
              type="radio"
              name="plan"
              value={p.id}
              checked={active}
              onChange={() => onChange(p.id)}
              className="sr-only"
            />
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{isYearly ? "Yearly" : "Monthly"}</span>
              {isYearly && savings > 0 && (
                <span className="rounded-full bg-linear-to-r from-violet to-coral px-2 py-0.5 text-[11px] font-semibold text-white">
                  Save {savings}%
                </span>
              )}
            </span>
            <span className="text-2xl font-semibold tracking-tight">
              {formatMoney(p.amount, p.currency)}
              <span className="text-sm font-normal text-muted">/{isYearly ? "year" : "month"}</span>
            </span>
            <span className="text-xs text-muted">
              {isYearly
                ? `Just ${formatMoney(Math.round(p.amount / 12), p.currency)}/month, billed yearly`
                : "Billed monthly. Cancel anytime"}
            </span>
          </label>
        );
      })}
    </div>
  );
}
