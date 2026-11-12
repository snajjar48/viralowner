"use client";

// Stripe card-field setup shared by sign-up and the plans page.
import { loadStripe, type StripeElementsOptions } from "@stripe/stripe-js";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
export const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export const baseOptions = {
  fonts: [{ cssSrc: "https://fonts.googleapis.com/css2?family=Lexend:wght@400;500&display=swap" }],
  appearance: {
    theme: "night",
    variables: {
      colorPrimary: "#8a4cf0",
      colorBackground: "#18181d",
      colorText: "#f5f5f7",
      colorTextSecondary: "#a1a1aa",
      colorTextPlaceholder: "#71717a",
      colorDanger: "#f63165",
      fontFamily: "Lexend, system-ui, sans-serif",
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
export const paymentElementOptions = {
  fields: {
    billingDetails: { name: "never", email: "never", phone: "never", address: "never" },
  },
  wallets: { applePay: "never", googlePay: "never", link: "never" },
} as const;

