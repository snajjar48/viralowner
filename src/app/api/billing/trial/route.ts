import { getStripe } from "@/lib/stripe";
import { trialFromSetupIntent } from "@/lib/trial";

/**
 * Called right after the browser saves the card for a free trial (the
 * webhook does the same later). Reads the SetupIntent from Stripe itself, so
 * it can only ever act on Stripe's real state.
 *   → { trial: "claimed" }    the free video is ready to use
 *   → { trial: "card_used" }  this card already had a free trial on another account
 */
export async function POST(request: Request) {
  let setupIntentId: unknown;
  try {
    ({ setupIntentId } = await request.json());
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  if (typeof setupIntentId !== "string" || !/^seti_[A-Za-z0-9]+$/.test(setupIntentId)) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  try {
    const si = await getStripe().setupIntents.retrieve(setupIntentId);
    const trial = await trialFromSetupIntent(si);
    if (!trial) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ trial });
  } catch (error) {
    console.error("Trial claim failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
