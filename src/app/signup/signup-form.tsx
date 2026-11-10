"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { buttonClass, Field, FormError, inputClass } from "@/components/form";
import { COUNTRIES } from "@/lib/countries";
import { PASSWORD_MAX, PASSWORD_MIN, type BillingAddress } from "@/lib/signup-validation";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

const elementsOptions: StripeElementsOptions = {
  mode: "setup",
  currency: "usd",
  allowedPaymentMethodTypes: ["card"],
  fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500&display=swap" }],
  appearance: {
    theme: "night",
    variables: {
      colorPrimary: "#7b2ff7",
      colorBackground: "#16161b",
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
};

export function SignupForm() {
  if (!stripePromise) {
    return (
      <p className="text-center text-sm text-coral">
        Payments aren’t set up yet (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is missing).
      </p>
    );
  }
  return (
    <Elements stripe={stripePromise} options={elementsOptions}>
      <SignupFields />
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

function SignupFields() {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  // Set to the address we emailed when confirmation is required.
  const [checkEmail, setCheckEmail] = useState("");
  // Once the account exists, only the card can be retried.
  const account = useRef<{ clientSecret: string; needsEmailConfirmation: boolean; details: Details }>(
    null,
  );
  const [accountCreated, setAccountCreated] = useState(false);

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
          needsEmailConfirmation: Boolean(result.needsEmailConfirmation),
          details: values.details,
        };
        setAccountCreated(true);
      }

      const { clientSecret, needsEmailConfirmation, details } = account.current;
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
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
          `Your account is set up, but your card couldn’t be saved: ${
            confirmError.message ?? "it was declined."
          } Please try another card.`,
        );
        return;
      }

      await fetch("/api/auth/payment-method", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupIntentId: setupIntent.id }),
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
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
        <p className="text-lg font-medium">Check your email.</p>
        <p className="mt-2 text-muted">
          We sent a link to {checkEmail}. Click it to confirm your account,
          then you’re in.
        </p>
      </div>
    );
  }

  const locked = accountCreated;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-8">
      {/* Honeypot: hidden from people, tempting to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset className="flex flex-col gap-4" disabled={submitting && !locked}>
        <legend className="mb-4 text-sm font-medium tracking-wide text-foreground uppercase">
          Your details
        </legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="firstName">
            <input id="firstName" name="firstName" required maxLength={50} autoComplete="given-name" readOnly={locked} className={inputClass} />
          </Field>
          <Field label="Last name" htmlFor="lastName">
            <input id="lastName" name="lastName" required maxLength={50} autoComplete="family-name" readOnly={locked} className={inputClass} />
          </Field>
        </div>
        <Field label="Phone number" htmlFor="phone">
          <input id="phone" name="phone" type="tel" required autoComplete="tel" placeholder="+1 555 123 4567" pattern="^\+?[\d\s().\-]{10,20}$" readOnly={locked} className={inputClass} />
        </Field>
        <Field label="Email" htmlFor="email">
          <input id="email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="you@example.com" readOnly={locked} className={inputClass} />
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={submitting && !locked}>
        <legend className="mb-4 text-sm font-medium tracking-wide text-foreground uppercase">
          Billing address
        </legend>
        <Field label="Country" htmlFor="country">
          <select id="country" name="country" required defaultValue="US" disabled={locked} className={`${inputClass} appearance-none`}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code} className="bg-background">
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Address" htmlFor="line1">
          <input id="line1" name="line1" required maxLength={200} autoComplete="address-line1" placeholder="Street address" readOnly={locked} className={inputClass} />
        </Field>
        <Field label="Apartment, suite, etc. (optional)" htmlFor="line2">
          <input id="line2" name="line2" maxLength={200} autoComplete="address-line2" readOnly={locked} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" htmlFor="city">
            <input id="city" name="city" required maxLength={100} autoComplete="address-level2" readOnly={locked} className={inputClass} />
          </Field>
          <Field label="State / region" htmlFor="state">
            <input id="state" name="state" maxLength={100} autoComplete="address-level1" readOnly={locked} className={inputClass} />
          </Field>
          <Field label="ZIP / postal code" htmlFor="postalCode">
            <input id="postalCode" name="postalCode" required maxLength={20} autoComplete="postal-code" readOnly={locked} className={inputClass} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="mb-4 text-sm font-medium tracking-wide text-foreground uppercase">
          Payment method
        </legend>
        <PaymentElement
          options={{
            fields: {
              billingDetails: { name: "never", email: "never", phone: "never", address: "never" },
            },
            wallets: { applePay: "never", googlePay: "never", link: "never" },
          }}
        />
        <p className="text-xs text-muted">
          Your card is stored securely by Stripe. You won’t be charged today.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={submitting && !locked}>
        <legend className="mb-4 text-sm font-medium tracking-wide text-foreground uppercase">
          Password
        </legend>
        <Field label={`Password (at least ${PASSWORD_MIN} characters)`} htmlFor="password">
          <input id="password" name="password" type="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" readOnly={locked} className={inputClass} />
        </Field>
        <Field label="Confirm password" htmlFor="confirmPassword">
          <input id="confirmPassword" name="confirmPassword" type="password" required minLength={PASSWORD_MIN} maxLength={PASSWORD_MAX} autoComplete="new-password" readOnly={locked} className={inputClass} />
        </Field>
      </fieldset>

      <label className="flex items-start gap-3 text-sm text-muted">
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

      <div className="flex flex-col gap-3">
        <button type="submit" disabled={submitting || !stripe} className={buttonClass}>
          {submitting ? "Creating your account…" : locked ? "Save card" : "Create account"}
        </button>
        <FormError id="signup-error" message={error} />
        <p className="text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground underline underline-offset-4">
            Log in
          </Link>
        </p>
      </div>
    </form>
  );
}
