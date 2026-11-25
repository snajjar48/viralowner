import "server-only";
import { APP_TAG } from "./billing";
import { getSql } from "./db";
import { removeUserPushTokens } from "./push";
import { deleteObject, deletePrefix, listEmojiKitKeys } from "./storage";
import { getStripe } from "./stripe";
import { createAdminClient } from "./supabase/server";

/**
 * Deletes an account for good (the "delete my account" button; App Store rule 5.1.1(v)):
 * 1. its ViralOwner subscription in Stripe is canceled now (the Stripe account is shared with other
 *    businesses: only subscriptions tagged as ViralOwner's are touched; past invoices stay, as the law needs);
 * 2. its videos, clips, inspo, renders, profile details and feedback are deleted, with their files;
 * 3. its login is deleted (its profile row goes with it).
 * The free-trial claim (the old account id and Stripe's card fingerprint) is kept so the trial can't be taken twice.
 * Throws if the subscription can't be canceled, so no one keeps paying for a deleted account.
 */
export async function deleteAccount(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("stripe_customer_id, email").eq("id", userId).maybeSingle();

  // 1. Billing first: if this fails, nothing is deleted yet.
  if (profile?.stripe_customer_id) {
    const stripe = getStripe();
    for await (const sub of stripe.subscriptions.list({ customer: profile.stripe_customer_id, status: "all", limit: 100 })) {
      if (sub.metadata?.app !== APP_TAG || sub.status === "canceled" || sub.status === "incomplete_expired") continue;
      await stripe.subscriptions.cancel(sub.id);
    }
  }

  // 2. Videos and everything in them (clips, inspo, versions go with each project), then their files.
  const sql = getSql();
  const projects = await sql`DELETE FROM projects WHERE user_id = ${userId} RETURNING id`;
  await sql`DELETE FROM business_profiles WHERE user_id = ${userId}`;
  await sql`DELETE FROM feedback WHERE user_id = ${userId}`;
  await removeUserPushTokens(userId);
  // trial_claims stays: only the deleted account's id and Stripe's card fingerprint (no card details), so the same
  // card can't take the free trial again.
  if (profile?.email) await sql`DELETE FROM waitlist_signups WHERE lower(email) = lower(${profile.email})`.catch(() => {});
  for (const p of projects) {
    try {
      await deletePrefix(`u/${userId}/p/${p.id}/`);
    } catch (error) {
      console.error(`Account deletion: files of project ${p.id} failed:`, error);
    }
  }
  try {
    const emoji = await listEmojiKitKeys(`u/${userId}/emoji/`);
    await Promise.all(emoji.map((o) => deleteObject(o.key)));
  } catch (error) {
    console.error("Account deletion: emoji kit files failed:", error);
  }

  // 3. The login itself (the profile row is deleted with it).
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
}
