// Supabase settings. Names cover the Vercel ↔ Supabase integration (with or
// without the "STORAGE_" prefix it was connected with) and Supabase's newer
// "publishable"/"secret" API keys.

function first(...values: (string | undefined)[]) {
  return values.find((value) => value) ?? "";
}

export function supabaseUrl() {
  return first(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_STORAGE_SUPABASE_URL,
    process.env.SUPABASE_URL,
    process.env.STORAGE_SUPABASE_URL,
  );
}

/** Public key: safe in the browser, limited by row-level security. */
export function supabasePublicKey() {
  return first(
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_STORAGE_SUPABASE_PUBLISHABLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_STORAGE_SUPABASE_ANON_KEY,
  );
}

/** Secret key: server only, bypasses row-level security. */
export function supabaseSecretKey() {
  return first(
    process.env.SUPABASE_SECRET_KEY,
    process.env.STORAGE_SUPABASE_SECRET_KEY,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.STORAGE_SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function isSupabaseConfigured() {
  return Boolean(supabaseUrl() && supabasePublicKey());
}
