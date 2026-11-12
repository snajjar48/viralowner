import "server-only";
import { isActiveStatus } from "./billing";
import { getSql } from "./db";
import {
  CHANGES_PER_VIDEO,
  parsePlanId,
  TRIAL_CHANGES,
  VIDEO_LIMITS,
  type Interval,
  type Tier,
} from "./plan-format";
import type { Project } from "./projects";
import { createAdminClient } from "./supabase/server";

/**
 * What an account can do right now:
 * - a paid plan gives VIDEO_LIMITS[tier] videos per month (yearly plans too,
 *   reset monthly), each with CHANGES_PER_VIDEO changes;
 * - the free trial is one video with TRIAL_CHANGES change, and needs a card
 *   on file (claimTrial). It never turns into a subscription by itself;
 * - the trial video never counts toward the plan's monthly videos.
 */
export interface Membership {
  plan: {
    tier: Tier;
    interval: Interval;
    status: string;
    periodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  /** The subscription's status when it isn't active (e.g. "canceled"), else null. */
  lapsedStatus: string | null;
  /** "available": claimed, video not made yet. "used": the free video was started. */
  trial: "none" | "available" | "used";
  /** This month's videos on the paid plan. */
  videos: { limit: number; used: number; resetsAt: string } | null;
  hasCustomer: boolean;
  /** Owner account(s) in UNLIMITED_EMAILS: no limits, no trial or plan needed. */
  unlimited: boolean;
}

/** Accounts with unlimited access, from the UNLIMITED_EMAILS env var (comma-separated). */
function isUnlimitedEmail(email: string | null | undefined) {
  if (!email) return false;
  const list = (process.env.UNLIMITED_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

export async function getMembership(userId: string): Promise<Membership> {
  const sql = getSql();
  const [{ data: profile, error }, claims, trialProjects] = await Promise.all([
    createAdminClient()
      .from("profiles")
      .select("email, plan, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id")
      .eq("id", userId)
      .maybeSingle(),
    sql`SELECT 1 FROM trial_claims WHERE user_id = ${userId}`,
    sql`SELECT 1 FROM projects WHERE user_id = ${userId} AND billing = 'trial' LIMIT 1`,
  ]);
  if (error) throw error;

  const parsed = parsePlanId(profile?.plan);
  const status = (profile?.subscription_status as string | null) ?? null;
  const active = Boolean(parsed && isActiveStatus(status));
  const periodEnd = (profile?.current_period_end as string | null) ?? null;

  let videos: Membership["videos"] = null;
  if (active && parsed) {
    const window = allowanceWindow(periodEnd ? new Date(periodEnd) : null, parsed.interval);
    videos = {
      limit: VIDEO_LIMITS[parsed.tier],
      used: await plannedVideosSince(userId, window.start),
      resetsAt: window.end.toISOString(),
    };
  }

  return {
    plan:
      active && parsed
        ? { ...parsed, status: status!, periodEnd, cancelAtPeriodEnd: Boolean(profile?.cancel_at_period_end) }
        : null,
    lapsedStatus: active ? null : status,
    trial: trialProjects.length ? "used" : claims.length ? "available" : "none",
    videos,
    hasCustomer: Boolean(profile?.stripe_customer_id),
    unlimited: isUnlimitedEmail(profile?.email as string | null),
  };
}

async function plannedVideosSince(userId: string, start: Date) {
  const rows = await getSql()`
    SELECT count(*)::int AS n FROM projects
    WHERE user_id = ${userId} AND billing = 'plan' AND counted_at >= ${start.toISOString()}`;
  return Number(rows[0]?.n ?? 0);
}

function addMonths(date: Date, months: number) {
  const day = date.getUTCDate();
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/**
 * The month of videos "now" falls in. Monthly plans: the billing period.
 * Yearly plans: monthly slices of the billing year, starting on the day they
 * subscribed, so 10 a month means 10 a month, not 120 up front.
 */
export function allowanceWindow(periodEnd: Date | null, interval: Interval, now = new Date()) {
  if (!periodEnd) {
    // Shouldn't happen for an active plan; fall back to the calendar month.
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end: addMonths(start, 1) };
  }
  const periods = interval === "monthly" ? 1 : 12;
  const periodStart = addMonths(periodEnd, -periods);
  for (let k = periods - 1; k >= 0; k--) {
    const start = addMonths(periodStart, k);
    if (start <= now) return { start, end: k === periods - 1 ? periodEnd : addMonths(periodStart, k + 1) };
  }
  return { start: periodStart, end: addMonths(periodStart, 1) };
}

export function formatResetDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export type Blocked = { reason: "subscribe" | "limit"; message: string };

/** Can this account start a new video (count against trial or plan)? */
export function canStartVideo(m: Membership): { as: "trial" | "plan" } | Blocked {
  if (m.unlimited) return { as: "plan" };
  if (m.trial === "available") return { as: "trial" };
  if (m.plan && m.videos) {
    if (m.videos.used < m.videos.limit) return { as: "plan" };
    return {
      reason: "limit",
      message: `you’ve used your ${m.videos.limit} videos this month. they reset on ${formatResetDate(m.videos.resetsAt)}.`,
    };
  }
  if (m.trial === "used") {
    return { reason: "subscribe", message: "you’ve used your free video. choose a plan to make more." };
  }
  return { reason: "subscribe", message: "choose a plan to start making videos." };
}

/**
 * Changes (re-renders) this video still has. The first version is free once
 * the video is counted; every later non-failed version is a change. Trial
 * videos get TRIAL_CHANGES until the account subscribes, then the full amount.
 */
export function changesAllowed(m: Membership, project: Project) {
  if (m.unlimited) return Infinity;
  if (m.plan) return CHANGES_PER_VIDEO;
  if (project.billing === "trial") return TRIAL_CHANGES;
  return 0;
}

export async function versionsMade(projectId: string) {
  const rows = await getSql()`
    SELECT count(*)::int AS n FROM renders WHERE project_id = ${projectId} AND status <> 'failed'`;
  return Number(rows[0]?.n ?? 0);
}

export function changesLeft(m: Membership, project: Project, made: number) {
  return Math.max(0, changesAllowed(m, project) - Math.max(0, made - 1));
}

/**
 * Checks a new version of a project is allowed, and counts the video against
 * the trial or plan if this is its first version. Returns a `release`
 * function to undo the count if starting the render then fails validation.
 */
export async function claimRender(
  userId: string,
  project: Project,
): Promise<{ release: () => Promise<void> } | (Blocked & { status: number })> {
  const [m, made] = await Promise.all([getMembership(userId), versionsMade(project.id)]);
  const noop = { release: async () => {} };

  if (made === 0 && project.billing) return noop; // first version failed before; trying again is free
  if (made > 0) {
    // Projects from before limits existed have no billing; treat them like plan videos.
    if (changesLeft(m, project, made) > 0) return noop;
    if (!m.plan) {
      const message =
        project.billing === "trial"
          ? "you’ve used the free change on your trial video. choose a plan to keep editing it."
          : "your membership isn’t active. choose a plan to keep editing.";
      return { reason: "subscribe", message, status: 402 };
    }
    return {
      reason: "limit",
      message: `you’ve used all ${CHANGES_PER_VIDEO} changes for this video. start a new video to keep going.`,
      status: 402,
    };
  }

  const can = canStartVideo(m);
  if ("reason" in can) return { ...can, status: 402 };

  const sql = getSql();
  let claimed;
  if (m.unlimited) {
    // Counted as a plan video for the record, but never limited.
    claimed = await sql`
      UPDATE projects SET billing = 'plan', counted_at = now()
      WHERE id = ${project.id} AND user_id = ${userId} AND counted_at IS NULL
      RETURNING id`;
  } else if (can.as === "trial") {
    claimed = await sql`
      UPDATE projects SET billing = 'trial', counted_at = now()
      WHERE id = ${project.id} AND user_id = ${userId} AND counted_at IS NULL
        AND EXISTS (SELECT 1 FROM trial_claims WHERE user_id = ${userId})
        AND NOT EXISTS (SELECT 1 FROM projects WHERE user_id = ${userId} AND billing = 'trial')
      RETURNING id`;
  } else {
    const window = allowanceWindow(m.plan!.periodEnd ? new Date(m.plan!.periodEnd) : null, m.plan!.interval);
    claimed = await sql`
      UPDATE projects SET billing = 'plan', counted_at = now()
      WHERE id = ${project.id} AND user_id = ${userId} AND counted_at IS NULL
        AND (SELECT count(*) FROM projects
             WHERE user_id = ${userId} AND billing = 'plan' AND counted_at >= ${window.start.toISOString()}) < ${m.videos!.limit}
      RETURNING id`;
  }
  if (!claimed.length) {
    return { reason: "limit", message: "you’ve run out of videos for now. refresh and try again.", status: 409 };
  }
  return {
    release: async () => {
      await sql`UPDATE projects SET billing = NULL, counted_at = NULL WHERE id = ${project.id} AND user_id = ${userId}`;
    },
  };
}

/** Max projects started but not yet made into a video, so inspo analysis can't be run without limit. */
const OPEN_DRAFTS = { trial: 3, plan: 15 };

/** Can this account start a new project (upload an inspo)? */
export async function canCreateProject(userId: string): Promise<null | (Blocked & { status: number })> {
  const m = await getMembership(userId);
  const can = canStartVideo(m);
  if ("reason" in can) return { ...can, status: 402 };
  const rows = await getSql()`
    SELECT count(*)::int AS n FROM projects
    WHERE user_id = ${userId} AND counted_at IS NULL AND created_at > now() - interval '30 days'`;
  if (m.unlimited) return null;
  const max = OPEN_DRAFTS[can.as];
  if (Number(rows[0]?.n ?? 0) >= max) {
    return {
      reason: "limit",
      message: `you have ${max} videos you haven’t finished yet. finish one of them first, from your dashboard.`,
      status: 429,
    };
  }
  return null;
}

/**
 * Records the free trial for an account and its card. One per account and
 * one per card, so a new account with the same card gets no second trial.
 */
export async function claimTrial(userId: string, cardFingerprint: string): Promise<"claimed" | "card_used"> {
  const sql = getSql();
  await sql`
    INSERT INTO trial_claims (user_id, card_fingerprint) VALUES (${userId}, ${cardFingerprint})
    ON CONFLICT DO NOTHING`;
  const rows = await sql`
    SELECT user_id FROM trial_claims WHERE user_id = ${userId} OR card_fingerprint = ${cardFingerprint}`;
  return rows.some((r) => String(r.user_id) === userId) ? "claimed" : "card_used";
}
