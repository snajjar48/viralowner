import "server-only";
import { createClient } from "./supabase/server";

/** The signed-in Supabase user's id, or null. Verifies the session with Supabase. */
export async function getUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
