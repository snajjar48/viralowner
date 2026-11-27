import type { User } from "@supabase/supabase-js";
import { isCategory, type VideoCategory } from "./categories";

/**
 * The one-time setup after sign-up (/welcome): the kind of videos they make (picked for them when they
 * start a video) and whether they finished or skipped it. Kept on the account's sign-in details
 * (user_metadata.onboarding), so no table is needed.
 */
export interface Onboarding {
  done: boolean;
  category: VideoCategory | null;
}

export function onboardingOf(user: Pick<User, "user_metadata"> | null | undefined): Onboarding {
  const raw = (user?.user_metadata as { onboarding?: { done?: unknown; category?: unknown } } | undefined)?.onboarding;
  return { done: raw?.done === true, category: isCategory(raw?.category) ? raw.category : null };
}
