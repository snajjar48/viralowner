import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabasePublicKey, supabaseUrl } from "./env";

/**
 * Refreshes the Supabase session cookie on each request and, when
 * `requireUser` is set, sends signed-out visitors to /login.
 */
export async function updateSession(request: NextRequest, requireUser: boolean) {
  let response = NextResponse.next({ request });
  let signedIn = false;

  if (isSupabaseConfigured()) {
    const supabase = createServerClient(supabaseUrl(), supabasePublicKey(), {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers ?? {}).forEach(([key, value]) =>
            response.headers.set(key, value),
          );
        },
      },
    });

    // Verifies the session token (don't trust the cookie without this).
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  }

  if (requireUser && !signedIn) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
    const redirect = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}
