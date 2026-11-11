import "server-only";
import { connection } from "next/server";
import { createClient } from "./supabase/server";

/** The signed-in Supabase user's id, or null. Verifies the session with Supabase. */
export async function getUserId(): Promise<string | null> {
  // Always per request (the session check reads the clock).
  await connection();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
