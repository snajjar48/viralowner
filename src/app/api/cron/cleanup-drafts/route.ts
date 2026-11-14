import { timingSafeEqual } from "node:crypto";
import { cleanUpDrafts } from "@/lib/cleanup";

export const maxDuration = 300;

/** Daily (vercel.json): deletes drafts nobody opened in 30 days. Vercel sends CRON_SECRET. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await cleanUpDrafts();
    console.log("Draft cleanup:", result);
    return Response.json(result);
  } catch (error) {
    console.error("Draft cleanup failed:", error);
    return Response.json({ error: "cleanup failed" }, { status: 500 });
  }
}
