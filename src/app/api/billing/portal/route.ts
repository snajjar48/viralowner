import type { NextRequest } from "next/server";
import { getPortalConfigurationId } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";

/** Opens Stripe's billing page (change plan, update card, cancel, invoices). */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "Please log in." }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", user.id)
      .maybeSingle();
    if (!profile?.stripe_customer_id) {
      return Response.json({ error: "No billing account found." }, { status: 404 });
    }

    const origin = request.nextUrl.origin;
    const session = await getStripe().billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      configuration: await getPortalConfigurationId(origin),
      return_url: `${origin}/dashboard`,
    });
    return Response.json({ url: session.url });
  } catch (error) {
    console.error("Opening billing portal failed:", error);
    return Response.json({ error: "Couldn’t open billing. Please try again." }, { status: 500 });
  }
}
