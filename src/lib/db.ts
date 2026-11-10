import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let client: NeonQueryFunction<false, false> | null = null;

/** Lazily create the Neon client so builds don't require DATABASE_URL. */
export function getSql() {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    client = neon(url);
  }
  return client;
}
