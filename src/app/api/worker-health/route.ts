import { unauthorized } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { workerHealth } from "@/lib/worker";

/**
 * Logged-in check that this deployment can reach the processing worker.
 * Shows pass/fail per part only (no details).
 */
export async function GET() {
  if (!(await getUserId())) return unauthorized();
  try {
    const health = await workerHealth();
    const checks = Object.fromEntries(Object.entries(health.checks).map(([name, c]) => [name, c.ok]));
    return Response.json({ ok: health.ok, checks }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Worker health check failed:", error);
    return Response.json({ ok: false, error: "can’t reach the worker" }, { status: 502 });
  }
}
