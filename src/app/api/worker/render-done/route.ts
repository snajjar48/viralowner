import { timingSafeEqual } from "node:crypto";
import { emailRenderFinished } from "@/lib/notify";

/**
 * The processing worker calls this when a version finishes (worker/app.py,
 * notify_job), with the shared WORKER_TOKEN. We re-check the result with the
 * worker ourselves, then email the user.
 */
export async function POST(request: Request) {
  const token = process.env.WORKER_TOKEN;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token ?? ""}`);
  if (!token || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { projectId?: unknown; renderId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  try {
    const result = await emailRenderFinished(String(body.projectId ?? ""), String(body.renderId ?? ""));
    return Response.json({ result });
  } catch (error) {
    console.error("Render-done notification failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
