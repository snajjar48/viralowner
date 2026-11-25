import "server-only";
import { headers } from "next/headers";

/** The iPhone app's web view says so in its user agent ("ViralOwnerApp/<version>"). */
export const APP_AGENT = /\bViralOwnerApp\//;

/** Whether this page is being loaded inside the iPhone app. */
export async function isAppRequest(): Promise<boolean> {
  return APP_AGENT.test((await headers()).get("user-agent") ?? "");
}
