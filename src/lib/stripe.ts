import "server-only";
import Stripe from "stripe";

let stripe: Stripe | undefined;

/** Server-side Stripe client (uses the secret key). */
export function getStripe() {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set (see .env.example).");
    stripe = new Stripe(key);
  }
  return stripe;
}
