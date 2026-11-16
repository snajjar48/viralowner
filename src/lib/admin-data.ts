import "server-only";
import type Stripe from "stripe";
import { getBusiness } from "./business";
import { getSql } from "./db";
import { getMembership } from "./membership";
import { getPlans } from "./plans";
import { createDownloadUrl } from "./storage";
import { getStripe } from "./stripe";
import { createAdminClient } from "./supabase/server";
import { supabaseUrl } from "./supabase/env";
import { workerHealth } from "./worker";

// Everything the admin dashboard shows. The Stripe account is shared with another business, so
// every Stripe number is limited to viralowner's own prices.

const DAY = 86_400_000;
const since = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const num = (v: unknown) => Number(v ?? 0);

export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  plan: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  stripe_customer_id: string | null;
  created_at: string;
}

async function allProfiles(): Promise<Profile[]> {
  const { data, error } = await createAdminClient()
    .from("profiles")
    .select(
      "id, first_name, last_name, email, phone, plan, subscription_status, current_period_end, cancel_at_period_end, stripe_customer_id, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

/** Sign-in times from Supabase Auth, by user id. */
async function authInfo(): Promise<Map<string, { lastSignIn: string | null; confirmed: boolean }>> {
  const out = new Map<string, { lastSignIn: string | null; confirmed: boolean }>();
  const admin = createAdminClient().auth.admin;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.listUsers({ page, perPage: 1000 });
    if (error || !data?.users.length) break;
    for (const u of data.users) out.set(u.id, { lastSignIn: u.last_sign_in_at ?? null, confirmed: !!u.email_confirmed_at });
    if (data.users.length < 1000) break;
  }
  return out;
}

const ACTIVE = new Set(["active", "trialing", "past_due"]);

// ---- Stripe (viralowner prices only)

async function viralownerPrices() {
  const plans = (await getPlans()) ?? [];
  return new Map(plans.map((p) => [p.priceId, p]));
}

function linePrice(line: Stripe.InvoiceLineItem): string | null {
  const l = line as unknown as { pricing?: { price_details?: { price?: string } }; price?: { id?: string } };
  return l.pricing?.price_details?.price ?? l.price?.id ?? null;
}

export async function stripeSummary() {
  try {
    const stripe = getStripe();
    const prices = await viralownerPrices();
    if (!prices.size) return { ok: false as const, error: "plans aren’t set up in Stripe yet." };
    const subs: Stripe.Subscription[] = [];
    for (const priceId of prices.keys()) {
      for await (const s of stripe.subscriptions.list({ price: priceId, status: "all", limit: 100 })) {
        subs.push(s);
        if (subs.length > 2000) break;
      }
    }
    const byPlan = new Map<string, number>();
    let mrr = 0;
    let active = 0;
    let canceling = 0;
    let pastDue = 0;
    for (const s of subs) {
      if (!ACTIVE.has(s.status)) continue;
      const plan = prices.get(s.items.data[0]?.price.id ?? "");
      if (!plan) continue;
      active++;
      if (s.cancel_at_period_end) canceling++;
      if (s.status === "past_due") pastDue++;
      byPlan.set(plan.id, (byPlan.get(plan.id) ?? 0) + 1);
      mrr += plan.interval === "monthly" ? plan.amount : plan.amount / 12;
    }
    const currency = [...prices.values()][0]?.currency ?? "usd";
    let revenue30 = 0;
    let paid30 = 0;
    for await (const inv of stripe.invoices.list({ status: "paid", created: { gte: Math.floor((Date.now() - 30 * DAY) / 1000) }, limit: 100 })) {
      if (inv.lines.data.some((l) => prices.has(linePrice(l) ?? ""))) {
        revenue30 += inv.amount_paid;
        paid30++;
      }
      if (paid30 > 1000) break;
    }
    return { ok: true as const, active, canceling, pastDue, byPlan: Object.fromEntries(byPlan), mrr: Math.round(mrr), revenue30, paid30, currency };
  } catch (error) {
    console.error("Admin Stripe summary failed:", error);
    return { ok: false as const, error: "couldn’t reach Stripe." };
  }
}

// ---- overview

export async function overview() {
  const sql = getSql();
  const [profiles, waitlist, projects, renders, storage, health, stripe, feedback] = await Promise.all([
    allProfiles(),
    sql`SELECT count(*)::int n, count(*) FILTER (WHERE created_at > ${since(7)})::int week FROM waitlist_signups`,
    sql`SELECT count(*)::int n, count(*) FILTER (WHERE created_at > ${since(7)})::int week,
               count(*) FILTER (WHERE to_jsonb(p) ->> 'kind' = 'scratch')::int scratch,
               count(*) FILTER (WHERE counted_at IS NOT NULL)::int counted
        FROM projects p WHERE to_jsonb(p) ->> 'deleted_at' IS NULL`,
    sql`SELECT count(*) FILTER (WHERE status = 'done' AND created_at > ${since(7)})::int done7,
               count(*) FILTER (WHERE status = 'done' AND created_at > ${since(30)})::int done30,
               count(*) FILTER (WHERE status = 'failed' AND created_at > ${since(7)})::int failed7,
               count(*) FILTER (WHERE status IN ('queued', 'processing'))::int running,
               percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (completed_at - created_at)))
                 FILTER (WHERE status = 'done' AND completed_at IS NOT NULL AND created_at > ${since(7)}) median_s
        FROM renders`,
    sql`SELECT coalesce(sum(size_bytes), 0)::bigint bytes, count(*)::int clips FROM clips WHERE status = 'uploaded'`,
    workerHealth().catch(() => null),
    stripeSummary(),
    sql`SELECT count(*)::int n, count(*) FILTER (WHERE created_at > ${since(7)})::int week,
               count(*) FILTER (WHERE rating = 'not_quite')::int unhappy FROM feedback`.catch(() => [{ n: 0, week: 0, unhappy: 0 }]),
  ]);
  const plans: Record<string, number> = {};
  for (const p of profiles) {
    if (p.plan && ACTIVE.has(p.subscription_status ?? "")) plans[p.plan] = (plans[p.plan] ?? 0) + 1;
  }
  return {
    users: { total: profiles.length, week: profiles.filter((p) => p.created_at > since(7)).length, plans },
    waitlist: { total: num(waitlist[0].n), week: num(waitlist[0].week) },
    feedback: { total: num(feedback[0].n), week: num(feedback[0].week), unhappy: num(feedback[0].unhappy) },
    projects: { total: num(projects[0].n), week: num(projects[0].week), scratch: num(projects[0].scratch), counted: num(projects[0].counted) },
    renders: {
      done7: num(renders[0].done7),
      done30: num(renders[0].done30),
      failed7: num(renders[0].failed7),
      running: num(renders[0].running),
      medianS: renders[0].median_s == null ? null : Math.round(num(renders[0].median_s)),
    },
    storage: { bytes: num(storage[0].bytes), clips: num(storage[0].clips) },
    worker: health,
    stripe,
  };
}

// ---- users

export interface UserRow extends Profile {
  lastSignIn: string | null;
  confirmed: boolean;
  projects: number;
  videos: number;
  failed: number;
  lastActive: string | null;
  /** Did something in the last 14 days. */
  recent: boolean;
  bytes: number;
}

export async function listUsers(): Promise<UserRow[]> {
  const sql = getSql();
  const [profiles, auth, projects, renders, storage] = await Promise.all([
    allProfiles(),
    authInfo().catch(() => new Map()),
    sql`SELECT user_id, count(*)::int n, max(updated_at) last FROM projects p
        WHERE to_jsonb(p) ->> 'deleted_at' IS NULL GROUP BY user_id`,
    sql`SELECT p.user_id, count(*) FILTER (WHERE r.status = 'done')::int done, count(*) FILTER (WHERE r.status = 'failed')::int failed
        FROM renders r JOIN projects p ON p.id = r.project_id GROUP BY p.user_id`,
    sql`SELECT p.user_id, coalesce(sum(c.size_bytes), 0)::bigint bytes FROM clips c JOIN projects p ON p.id = c.project_id
        WHERE c.status = 'uploaded' GROUP BY p.user_id`,
  ]);
  const by = <T extends Record<string, unknown>>(rows: T[]) => new Map(rows.map((r) => [String(r.user_id), r]));
  const pj = by(projects);
  const rd = by(renders);
  const st = by(storage);
  return profiles.map((p) => ({
    ...p,
    lastSignIn: auth.get(p.id)?.lastSignIn ?? null,
    confirmed: auth.get(p.id)?.confirmed ?? false,
    projects: num(pj.get(p.id)?.n),
    videos: num(rd.get(p.id)?.done),
    failed: num(rd.get(p.id)?.failed),
    lastActive: pj.get(p.id)?.last ? new Date(pj.get(p.id)!.last as string).toISOString() : null,
    bytes: num(st.get(p.id)?.bytes),
    recent: !!pj.get(p.id)?.last && new Date(pj.get(p.id)!.last as string).toISOString() > since(14),
  }));
}

export async function userDetail(userId: string) {
  const sql = getSql();
  const admin = createAdminClient();
  const [{ data: profile }, { data: auth }, business, membership, projects, renders, claims, storage] = await Promise.all([
    admin.from("profiles").select("*").eq("id", userId).maybeSingle(),
    admin.auth.admin.getUserById(userId),
    getBusiness(userId),
    getMembership(userId).catch(() => null),
    sql`SELECT p.id, to_jsonb(p) ->> 'kind' kind, coalesce(to_jsonb(p) ->> 'name', '') name, p.status, p.created_at,
               p.updated_at, p.billing, to_jsonb(p) ->> 'deleted_at' deleted_at, left(coalesce(p.prompt, ''), 300) prompt,
               (SELECT count(*)::int FROM clips c WHERE c.project_id = p.id AND c.status = 'uploaded') clips,
               (SELECT coalesce(sum(size_bytes), 0)::bigint FROM clips c WHERE c.project_id = p.id AND c.status = 'uploaded') bytes
        FROM projects p WHERE p.user_id = ${userId} ORDER BY p.updated_at DESC`,
    sql`SELECT r.project_id, r.version, r.status, r.storage_key, r.created_at, r.completed_at, r.error,
               r.settings ->> 'request' request
        FROM renders r JOIN projects p ON p.id = r.project_id WHERE p.user_id = ${userId}
        ORDER BY r.project_id, r.version`,
    sql`SELECT claimed_at FROM trial_claims WHERE user_id = ${userId}`,
    sql`SELECT coalesce(sum(c.size_bytes), 0)::bigint bytes FROM clips c JOIN projects p ON p.id = c.project_id WHERE p.user_id = ${userId}`,
  ]);
  if (!profile) return null;
  const email = (profile as Profile).email ?? "";
  const [waitlist, stripe] = await Promise.all([
    email ? sql`SELECT created_at, coalesce(to_jsonb(w) ->> 'source', '') source FROM waitlist_signups w WHERE lower(email) = ${email.toLowerCase()}` : [],
    stripeCustomer((profile as Profile).stripe_customer_id),
  ]);
  const videos = await Promise.all(
    renders.map(async (r) => ({
      projectId: String(r.project_id),
      version: num(r.version),
      status: String(r.status),
      createdAt: new Date(r.created_at as string).toISOString(),
      seconds: r.completed_at ? Math.round((+new Date(r.completed_at as string) - +new Date(r.created_at as string)) / 1000) : null,
      error: (r.error as string | null) ?? null,
      request: (r.request as string | null) ?? null,
      url: r.status === "done" && r.storage_key ? await createDownloadUrl(String(r.storage_key), { expiresIn: 3600 }).catch(() => null) : null,
    })),
  );
  return {
    profile: profile as Profile & Record<string, unknown>,
    auth: {
      createdAt: auth?.user?.created_at ?? null,
      lastSignIn: auth?.user?.last_sign_in_at ?? null,
      confirmed: !!auth?.user?.email_confirmed_at,
    },
    business,
    membership,
    trialClaimedAt: claims[0] ? new Date(claims[0].claimed_at as string).toISOString() : null,
    storageBytes: num(storage[0]?.bytes),
    waitlist: waitlist[0] ? { at: new Date(waitlist[0].created_at as string).toISOString(), source: String(waitlist[0].source) } : null,
    stripe,
    projects: projects.map((p) => ({
      id: String(p.id),
      kind: p.kind === "scratch" ? "scratch" : "remake",
      name: String(p.name),
      prompt: String(p.prompt),
      status: String(p.status),
      billing: (p.billing as string | null) ?? null,
      deleted: !!p.deleted_at,
      clips: num(p.clips),
      bytes: num(p.bytes),
      createdAt: new Date(p.created_at as string).toISOString(),
      updatedAt: new Date(p.updated_at as string).toISOString(),
      versions: videos.filter((v) => v.projectId === String(p.id)),
    })),
  };
}

async function stripeCustomer(customerId: string | null) {
  if (!customerId) return null;
  try {
    const stripe = getStripe();
    const prices = await viralownerPrices();
    const [customer, subs, invoices] = await Promise.all([
      stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] }),
      stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 }),
      stripe.invoices.list({ customer: customerId, limit: 20 }),
    ]);
    const pm = !customer.deleted ? customer.invoice_settings?.default_payment_method : null;
    const card = pm && typeof pm !== "string" ? pm.card : null;
    return {
      id: customerId,
      url: `https://dashboard.stripe.com/customers/${customerId}`,
      card: card ? `${card.brand} •••• ${card.last4} (exp ${card.exp_month}/${card.exp_year})` : null,
      subscriptions: subs.data
        .filter((s) => prices.has(s.items.data[0]?.price.id ?? ""))
        .map((s) => ({
          id: s.id,
          status: s.status,
          plan: prices.get(s.items.data[0]!.price.id)?.id ?? "",
          cancelAtPeriodEnd: s.cancel_at_period_end,
          created: new Date(s.created * 1000).toISOString(),
          url: `https://dashboard.stripe.com/subscriptions/${s.id}`,
        })),
      invoices: invoices.data
        .filter((i) => i.lines.data.some((l) => prices.has(linePrice(l) ?? "")))
        .map((i) => ({
          id: i.id,
          status: i.status,
          amount: i.amount_paid || i.amount_due,
          currency: i.currency,
          created: new Date(i.created * 1000).toISOString(),
          url: i.hosted_invoice_url ?? null,
        })),
    };
  } catch (error) {
    console.error("Admin Stripe customer failed:", error);
    return { id: customerId, url: `https://dashboard.stripe.com/customers/${customerId}`, error: "couldn’t load from Stripe." } as const;
  }
}

// ---- waitlist

export async function listWaitlist() {
  const rows = await getSql()`
    SELECT id, email, coalesce(to_jsonb(w) ->> 'source', '') source, created_at FROM waitlist_signups w
    ORDER BY created_at DESC LIMIT 10000`;
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    source: String(r.source),
    createdAt: new Date(r.created_at as string).toISOString(),
  }));
}

export async function deleteWaitlistEntry(id: string) {
  await getSql()`DELETE FROM waitlist_signups WHERE id = ${id}`;
}

// ---- videos across everyone

export async function recentVersions(limit = 100) {
  const [rows, profiles] = await Promise.all([
    getSql()`
      SELECT r.project_id, r.version, r.status, r.stage, r.progress, r.created_at, r.completed_at, r.error,
             r.settings ->> 'request' request, p.user_id, to_jsonb(p) ->> 'kind' kind, coalesce(to_jsonb(p) ->> 'name', '') name
      FROM renders r JOIN projects p ON p.id = r.project_id
      ORDER BY r.created_at DESC LIMIT ${limit}`,
    allProfiles(),
  ]);
  const who = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((r) => {
    const u = who.get(String(r.user_id));
    return {
      projectId: String(r.project_id),
      version: num(r.version),
      status: String(r.status),
      stage: (r.stage as string | null) ?? null,
      progress: num(r.progress),
      createdAt: new Date(r.created_at as string).toISOString(),
      seconds: r.completed_at ? Math.round((+new Date(r.completed_at as string) - +new Date(r.created_at as string)) / 1000) : null,
      error: (r.error as string | null) ?? null,
      request: (r.request as string | null) ?? null,
      kind: r.kind === "scratch" ? "scratch" : "remake",
      name: String(r.name),
      userId: String(r.user_id),
      user: u ? `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.email || "?" : "?",
    };
  });
}

// ---- the services viralowner runs on

export function services() {
  const ref = (() => {
    try {
      return new URL(supabaseUrl()).hostname.split(".")[0];
    } catch {
      return "";
    }
  })();
  return [
    { name: "Stripe", what: "payments, subscriptions, invoices, refunds", url: "https://dashboard.stripe.com" },
    { name: "Supabase", what: "accounts, sign-ins, profiles, email settings", url: ref ? `https://supabase.com/dashboard/project/${ref}` : "https://supabase.com/dashboard" },
    { name: "Neon", what: "the database: projects, videos, waitlist", url: "https://console.neon.tech" },
    { name: "Cloudflare R2", what: "storage for clips, inspos and finished videos", url: "https://dash.cloudflare.com/?to=/:account/r2/overview" },
    { name: "Modal", what: "the video worker: renders, logs, costs", url: "https://modal.com/apps" },
    { name: "Vercel", what: "the website: deploys, domains, env vars, logs", url: "https://vercel.com/dashboard" },
    { name: "Anthropic", what: "the AI editor: usage, credits, auto-reload", url: "https://console.anthropic.com/settings/billing" },
    { name: "Resend", what: "emails: sign-up, video ready", url: "https://resend.com/emails" },
  ];
}

// ---- feedback from the download page

export interface FeedbackItem {
  id: string;
  rating: string | null;
  message: string;
  createdAt: string;
}
export interface FeedbackVideo {
  projectId: string | null;
  projectName: string;
  kind: string;
  deleted: boolean;
  version: number | null;
  status: string | null;
  request: string | null;
  url: string | null;
  items: FeedbackItem[];
}
export interface FeedbackPerson {
  userId: string;
  name: string;
  email: string;
  projects: number;
  versions: number;
  lastActive: string | null;
  videos: FeedbackVideo[];
  latest: string;
}

/** All feedback, by person, then by the video (version) it was left on, newest first. */
export async function listFeedback(userId?: string): Promise<FeedbackPerson[]> {
  const sql = getSql();
  let rows: Record<string, unknown>[];
  try {
    rows = userId
      ? await sql`
          SELECT f.*, r.storage_key, r.status r_status, r.settings ->> 'request' request,
                 coalesce(to_jsonb(p) ->> 'name', '') project_name, coalesce(to_jsonb(p) ->> 'kind', 'remake') kind,
                 p.id IS NULL OR to_jsonb(p) ->> 'deleted_at' IS NOT NULL deleted, left(coalesce(p.prompt, ''), 80) prompt
          FROM feedback f LEFT JOIN renders r ON r.id = f.render_id LEFT JOIN projects p ON p.id = f.project_id
          WHERE f.user_id = ${userId} ORDER BY f.created_at DESC LIMIT 500`
      : await sql`
          SELECT f.*, r.storage_key, r.status r_status, r.settings ->> 'request' request,
                 coalesce(to_jsonb(p) ->> 'name', '') project_name, coalesce(to_jsonb(p) ->> 'kind', 'remake') kind,
                 p.id IS NULL OR to_jsonb(p) ->> 'deleted_at' IS NOT NULL deleted, left(coalesce(p.prompt, ''), 80) prompt
          FROM feedback f LEFT JOIN renders r ON r.id = f.render_id LEFT JOIN projects p ON p.id = f.project_id
          ORDER BY f.created_at DESC LIMIT 2000`;
  } catch (error) {
    if (/relation "feedback" does not exist/.test(String(error))) return []; // before the migration
    throw error;
  }
  if (!rows.length) return [];
  const users = [...new Set(rows.map((r) => String(r.user_id)))];
  const [profiles, activity] = await Promise.all([
    allProfiles(),
    sql`
      SELECT p.user_id, count(DISTINCT p.id) projects, count(r.id) versions,
             greatest(max(p.updated_at), max(r.created_at)) last_active
      FROM projects p LEFT JOIN renders r ON r.project_id = p.id
      WHERE p.user_id = ANY(${users}::uuid[]) GROUP BY p.user_id`,
  ]);
  const who = new Map(profiles.map((p) => [p.id, p]));
  const act = new Map(activity.map((a) => [String(a.user_id), a]));
  const people = new Map<string, FeedbackPerson>();
  const urls = new Map<string, Promise<string | null>>();
  for (const r of rows) {
    const uid = String(r.user_id);
    const prof = who.get(uid);
    const a = act.get(uid);
    let person = people.get(uid);
    if (!person) {
      person = {
        userId: uid,
        name: prof ? `${prof.first_name ?? ""} ${prof.last_name ?? ""}`.trim() : "",
        email: prof?.email ?? "",
        projects: num(a?.projects),
        versions: num(a?.versions),
        lastActive: a?.last_active ? new Date(a.last_active as string).toISOString() : null,
        videos: [],
        latest: new Date(r.created_at as string).toISOString(),
      };
      people.set(uid, person);
    }
    const key = `${r.project_id ?? "none"}:${r.version ?? ""}`;
    let video = person.videos.find((v) => `${v.projectId ?? "none"}:${v.version ?? ""}` === key);
    if (!video) {
      const storageKey = r.storage_key ? String(r.storage_key) : null;
      if (storageKey && r.r_status === "done" && !urls.has(storageKey)) {
        urls.set(storageKey, createDownloadUrl(storageKey, { expiresIn: 3600 }).catch(() => null));
      }
      video = {
        projectId: r.project_id ? String(r.project_id) : null,
        projectName: String(r.project_name || r.prompt || ""),
        kind: r.kind === "scratch" ? "scratch" : "remake",
        deleted: Boolean(r.deleted),
        version: r.version === null ? null : num(r.version),
        status: (r.r_status as string | null) ?? null,
        request: (r.request as string | null) ?? null,
        url: storageKey,
        items: [],
      };
      person.videos.push(video);
    }
    video.items.push({
      id: String(r.id),
      rating: (r.rating as string | null) ?? null,
      message: String(r.message ?? ""),
      createdAt: new Date(r.created_at as string).toISOString(),
    });
  }
  // Signed links to watch each video (the storage key stood in until now).
  for (const person of people.values()) {
    for (const v of person.videos) v.url = v.url && urls.has(v.url) ? await urls.get(v.url)! : null;
  }
  return [...people.values()];
}

/** Per video category (lib/categories.ts): how many videos, versions and change requests it has. */
export async function categoryStats() {
  try {
    const rows = await getSql()`
      SELECT coalesce(p.category, 'none') AS category,
             count(DISTINCT p.id) AS projects,
             count(DISTINCT p.id) FILTER (WHERE p.created_at > now() - interval '30 days') AS projects30,
             count(r.id) FILTER (WHERE r.status = 'done') AS versions,
             count(r.id) FILTER (WHERE coalesce(r.settings ->> 'request', '') <> '') AS requests
      FROM projects p LEFT JOIN renders r ON r.project_id = p.id
      WHERE to_jsonb(p) ->> 'deleted_at' IS NULL
      GROUP BY 1`;
    return Object.fromEntries(
      rows.map((r) => [
        String(r.category),
        { projects: Number(r.projects), projects30: Number(r.projects30), versions: Number(r.versions), requests: Number(r.requests) },
      ]),
    ) as Record<string, { projects: number; projects30: number; versions: number; requests: number }>;
  } catch {
    return null; // before the categories migration runs
  }
}
