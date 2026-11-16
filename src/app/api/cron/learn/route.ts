import { timingSafeEqual } from "node:crypto";
import { learnFromEveryone } from "@/lib/lessons";

export const maxDuration = 300;

/** Daily (vercel.json): the editor learns from everyone's recent requests and feedback. Vercel sends CRON_SECRET. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await learnFromEveryone(Date.now() + 270_000);
    console.log("Editor lessons:", result);
    return Response.json(result);
  } catch (error) {
    console.error("Learning failed:", error);
    return Response.json({ error: "learning failed" }, { status: 500 });
  }
}
