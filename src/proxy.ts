import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE, isValidAccessToken } from "@/lib/site-access";
import { updateSession } from "@/lib/supabase/proxy";

// The only paths anyone can reach without the password.
const PUBLIC_PATHS = new Set([
  "/", // home page
  "/what-is-viralowner", // public: how it works
  "/why-viralowner", // public: why us
  "/pricing", // public: plans
  "/start", // public: landing page for ads
  "/made-with-viralowner", // public: videos made with viralowner
  "/terms",
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

// Pages that also need a signed-in account (on top of the site password).
const ACCOUNT_PREFIXES = ["/dashboard", "/new", "/scratch", "/projects", "/plans", "/business", "/profile", "/admin", "/reset-password"];

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

  // The showcase's thumbnails (public/showcase/) and each page's featured image.
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/showcase/") || pathname.endsWith("/opengraph-image")) {
    return NextResponse.next();
  }

  if (isValidAccessToken(request.cookies.get(ACCESS_COOKIE)?.value)) {
    const response = await updateSession(request, needsAccount(pathname));
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
    return response;
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const unlockUrl = new URL("/unlock", request.url);
  unlockUrl.searchParams.set("next", pathname + search);
  return NextResponse.redirect(unlockUrl);
}

export const config = {
  // Run on everything except Next.js build assets (JS/CSS chunks, images).
  matcher: ["/((?!_next/static|_next/image).*)"],
};
