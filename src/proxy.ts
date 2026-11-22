import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, isValidAccessToken } from "@/lib/site-access";
import { updateSession } from "@/lib/supabase/proxy";

// Pages anyone can reach with no sign-in or session work at all (the marketing pages, the
// legal pages, and the servers that call in: Stripe, the worker and Vercel's cron).
const PUBLIC_PATHS = new Set([
  "/", // home page
  "/home", // the logo: dashboard when signed in, home page otherwise
  "/what-is-viralowner", // public: how it works
  "/why-viralowner", // public: why us
  "/pricing", // public: plans
  "/start", // public: landing page for ads
  "/made-with-viralowner", // public: videos made with viralowner
  "/terms",
  "/privacy",
  "/robots.txt",
  "/sitemap.xml",
  "/apple-icon", // the site's phone icon
  "/logo.png", // the company logo search engines show
  "/api/waitlist", // waitlist signup
  "/join", // a tester's invite link (checks its own signed token)
  "/api/auth/tester-signup", // sign-up from that link; same check
  "/unlock", // password page
  "/api/unlock", // password check
  "/api/stripe/webhook", // Stripe can't know the password; verified by signature
  "/api/worker/render-done", // the processing worker; verified by WORKER_TOKEN
  "/api/cron/cleanup-drafts", // Vercel's daily cron; verified by CRON_SECRET
  "/api/cron/learn", // Vercel's daily cron (the editor learns from everyone); verified by CRON_SECRET
  "/logo.svg",
  "/icon.svg",
]);

// Sign-up stays behind the site password (SITE_PASSWORD, entered on /unlock) until it opens
// with NEXT_PUBLIC_SIGNUPS_OPEN=true. Everything else is open, and each API route checks sign-in itself.
const SIGNUPS_OPEN = process.env.NEXT_PUBLIC_SIGNUPS_OPEN === "true";
const PASSWORD_PATHS = SIGNUPS_OPEN ? [] : ["/signup", "/api/auth/signup"];

// Pages that need a signed-in account.
const ACCOUNT_PREFIXES = ["/dashboard", "/new", "/scratch", "/projects", "/plans", "/business", "/profile", "/tips", "/admin", "/reset-password"];

function needsAccount(pathname: string) {
  return ACCOUNT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** True when a browser sent this from another website (a forged request riding on someone's cookies). */
function fromAnotherSite(request: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false; // servers (Stripe, the worker, the cron) don't send one
  try {
    return new URL(origin).host !== request.nextUrl.host;
  } catch {
    return true;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Only viralowner's own pages can change anything (on top of SameSite cookies).
  if (pathname.startsWith("/api/") && pathname !== "/api/stripe/webhook" && fromAnotherSite(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Signed-in people go from the home page to their dashboard. Only checked when a sign-in cookie
  // is there, so visitors and search engines get the home page with no extra work.
  if (pathname === "/" && request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) {
    return updateSession(request, false, "/dashboard");
  }

  // Signed-in people opening the log-in page (the iPhone app starts there) go straight on: to where
  // they were headed (?next=, only this site's own pages), else their dashboard.
  if (pathname === "/login" && request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) {
    const next = request.nextUrl.searchParams.get("next") ?? "";
    const ok = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") && !next.startsWith("/login");
    const to = ok ? next : "/dashboard";
    return updateSession(request, false, to);
  }

  // The showcase's thumbnails (public/showcase/) and each page's featured image.
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/showcase/") || pathname.endsWith("/opengraph-image")) {
    return NextResponse.next();
  }

  if (PASSWORD_PATHS.includes(pathname) && !isValidAccessToken(request.cookies.get(ACCESS_COOKIE)?.value)) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const unlockUrl = new URL("/unlock", request.url);
    unlockUrl.searchParams.set("next", pathname + search);
    return NextResponse.redirect(unlockUrl);
  }

  // Account pages, sign-in pages and the app: not for search engines.
  const response = await updateSession(request, needsAccount(pathname));
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

export const config = {
  // Run on everything except Next.js build assets (JS/CSS chunks, images).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
