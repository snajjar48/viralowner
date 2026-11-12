import "server-only";
import { getSql } from "./db";
import { sendEmail, type Email } from "./email";
import { CHANGES_PER_VIDEO, TIER_NAMES, TRIAL_CHANGES, VIDEO_LIMITS, type Tier } from "./plan-format";
import { getRender, isUuid } from "./projects";
import { syncRender } from "./renders";
import { siteUrl } from "./site-url";
import { createAdminClient } from "./supabase/server";

async function recipient(userId: string) {
  const { data } = await createAdminClient()
    .from("profiles")
    .select("email, first_name")
    .eq("id", userId)
    .maybeSingle();
  if (!data?.email) return null;
  return { email: String(data.email), firstName: (data.first_name as string | null)?.trim() || null };
}

const hi = (name: string | null) => (name ? `hey ${name.toLowerCase()},` : "hey,");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The worker says a version finished. Confirm it with the engine (never trust
 * the callback's word alone), then email the owner once: "ready" or "failed".
 */
export async function emailRenderFinished(projectId: string, renderId: string) {
  if (!isUuid(projectId) || !isUuid(renderId)) return "invalid";
  const sql = getSql();
  const owner = await sql`SELECT user_id FROM projects WHERE id = ${projectId}`;
  if (!owner[0]) return "unknown";
  let render = await getRender(projectId, renderId);
  if (!render) return "unknown";

  // The callback can arrive a moment before the engine reports the result.
  for (let i = 0; i < 6 && (render.status === "queued" || render.status === "processing"); i++) {
    if (i > 0) await sleep(2500);
    render = await syncRender(projectId, render);
  }
  if (render.status !== "done" && render.status !== "failed") return "not_finished";

  const claimed = await sql`
    UPDATE renders SET emailed_at = now()
    WHERE id = ${renderId} AND project_id = ${projectId} AND emailed_at IS NULL
    RETURNING id`;
  if (!claimed.length) return "already_sent";

  const to = await recipient(String(owner[0].user_id));
  if (!to) return "no_email";
  const ok = await sendEmail(
    render.status === "done"
      ? videoReadyEmail(to, projectId, render.version)
      : videoFailedEmail(to, projectId, renderId, render.version, render.error),
  );
  if (!ok) await sql`UPDATE renders SET emailed_at = NULL WHERE id = ${renderId}`; // let a later callback retry
  return ok ? "sent" : "send_failed";
}

/** A failed version is being tried again: its outcome should be emailed again. */
export async function resetRenderEmail(renderId: string) {
  // Never block a retry over an email detail (e.g. before migration 0005 runs).
  await getSql()`UPDATE renders SET emailed_at = NULL WHERE id = ${renderId}`.catch((error) =>
    console.error("Resetting render email failed:", error),
  );
}

export async function emailTrialWelcome(userId: string) {
  const to = await recipient(userId);
  if (to) await sendEmail(trialWelcomeEmail(to), `trial-welcome-${userId}`);
}

export async function emailPlanWelcome(userId: string, tier: Tier, subscriptionId: string) {
  const to = await recipient(userId);
  if (to) await sendEmail(planWelcomeEmail(to, tier), `plan-welcome-${subscriptionId}`);
}

// ---- the emails themselves (also used by the test route)

type To = { email: string; firstName: string | null };

export function videoReadyEmail(to: To, projectId: string, version: number): Email {
  return {
    to: to.email,
    subject: version === 1 ? "your video is ready 🎬" : `version ${version} of your video is ready`,
    preview: "watch it, tweak it, then download it and post.",
    heading: version === 1 ? "your video is ready." : `version ${version} is ready.`,
    body: [
      hi(to.firstName),
      "we finished editing your video. watch it, ask for a change if anything’s off, then download it and post.",
    ],
    button: { label: "watch your video", href: `${siteUrl()}/projects/${projectId}/preview?v=${version}` },
    footnote: "we also wrote a caption and hashtags for you. they’re on the download page.",
  };
}

export function videoFailedEmail(
  to: To,
  projectId: string,
  renderId: string,
  version: number,
  error: string | null,
): Email {
  return {
    to: to.email,
    subject: "we couldn’t finish your video",
    preview: "trying again is free and doesn’t use a change.",
    heading: "we hit a snag making your video.",
    body: [
      hi(to.firstName),
      `something went wrong while we were editing version ${version}. ${error ?? ""}`.trim(),
      "trying again is free and doesn’t use one of your videos or changes.",
    ],
    button: { label: "try again", href: `${siteUrl()}/projects/${projectId}/status?render=${renderId}` },
  };
}

export function trialWelcomeEmail(to: To): Email {
  return {
    to: to.email,
    subject: "your free video is waiting",
    preview: "pick a viral video, film your clips, we do the editing.",
    heading: "welcome to viralowner.",
    body: [
      hi(to.firstName),
      `your free trial is ready: 1 video with ${TRIAL_CHANGES} change and a free download. here’s how it works: upload a viral video you love, we break down every shot, you film your own clips, and we edit them into your version.`,
      "your card is saved but hasn’t been charged, and it won’t be unless you choose a plan and press subscribe.",
    ],
    button: { label: "make my free video", href: `${siteUrl()}/new` },
  };
}

export function planWelcomeEmail(to: To, tier: Tier): Email {
  const videos = tier === "pro" ? `up to ${VIDEO_LIMITS.pro}` : String(VIDEO_LIMITS.basic);
  return {
    to: to.email,
    subject: `welcome to viralowner ${TIER_NAMES[tier]}`,
    preview: `${videos} videos a month, ${CHANGES_PER_VIDEO} changes each.`,
    heading: `you’re on ${TIER_NAMES[tier]}.`,
    body: [
      hi(to.firstName),
      `thanks for subscribing. you get ${videos} videos a month, each with ${CHANGES_PER_VIDEO} changes. your videos reset every month on the day you subscribed.`,
      "stripe will email your receipt. you can switch plans, update your card or cancel anytime from your dashboard.",
    ],
    button: { label: "make a video", href: `${siteUrl()}/new` },
  };
}
