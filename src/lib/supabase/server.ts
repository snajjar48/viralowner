import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabasePublicKey, supabaseSecretKey, supabaseUrl } from "./env";

/**
 * Supabase client acting as the signed-in user (session read from cookies).
 * Use in Server Components and Route Handlers. Create a new one per request.
 */
export async function createClient() {
  // Read cookies first: it marks the caller as per-request (never prerendered).
  const cookieStore = await cookies();
  const url = supabaseUrl();
  const key = supabasePublicKey();
  if (!url || !key) throw new Error("Supabase is not configured (see .env.example).");

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components can't set cookies; the proxy refreshes sessions.
        }
      },
    },
  });
}

/** Admin client that bypasses row-level security. Server only. */
export function createAdminClient() {
  const url = supabaseUrl();
  const key = supabaseSecretKey();
  if (!url || !key) throw new Error("Supabase secret key is not configured (see .env.example).");

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
