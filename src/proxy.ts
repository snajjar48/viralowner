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
  "/opengraph-image", // the picture shown when a page is shared
  "/api/waitlist", // waitlist signup
  "/unlock", // password page
  "/api/unlock", // password check
  "/api/stripe/webhook", // Stripe can't know the password; verified by signature
  "/api/worker/render-done", // the processing worker; verified by WORKER_TOKEN
  "/api/cron/cleanup-drafts", // Vercel's daily cron; verified by CRON_SECRET
  "/logo.svg",
  "/icon.svg",
]);

// Pages that also need a signed-in account (on top of the site password).
const ACCOUNT_PREFIXES = ["/dashboard", "/new", "/scratch", "/projects", "/plans", "/business", "/profile", "/reset-password"];

function needsAccount(pathname: string) {
  return ACCOUNT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // The showcase's thumbnails (public/showcase/).
  if (PUBLIC_PATHS.has(pathname) || pathname.startsWith("/showcase/")) {
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
