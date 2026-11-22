import { revalidateTag } from "next/cache";
import { jsonError } from "@/lib/api";
import { adminSession } from "@/lib/admin-auth";
import { APP_TAG } from "@/lib/billing";
import { createPlanPrices, PLANS_TAG } from "@/lib/plans";

/** Makes the plans' prices in Stripe (Basic, Plus and Pro, monthly and yearly). Owner only. */
export async function POST() {
  if (!(await adminSession())) return jsonError("not found.", 404);
  try {
    const done = await createPlanPrices(APP_TAG);
    revalidateTag(PLANS_TAG, { expire: 0 }); // the site shows the new prices right away
    return Response.json({ ok: true, done });
  } catch (error) {
    console.error("Creating plan prices failed:", error);
    return jsonError(error instanceof Error ? error.message : "that didn’t work.", 500);
  }
}
