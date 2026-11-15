import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A worker job id handed to the browser, signed to one project, so a job can only be read back
 * through the project that started it.
 */
function sign(projectId: string, jobId: string) {
  const key = `${process.env.WORKER_TOKEN ?? ""}:viralowner-job-ticket-v1`;
  return createHmac("sha256", key).update(`${projectId}:${jobId}`).digest("hex").slice(0, 32);
}

export const jobTicket = (projectId: string, jobId: string) => `${jobId}.${sign(projectId, jobId)}`;

/** The job id inside a ticket, or null if it's not one this project was given. */
export function ticketJobId(projectId: string, ticket: string | null): string | null {
  const m = /^([A-Za-z0-9_-]{1,100})\.([0-9a-f]{32})$/.exec(ticket ?? "");
  if (!m || !process.env.WORKER_TOKEN) return null;
  const want = Buffer.from(sign(projectId, m[1]));
  return timingSafeEqual(Buffer.from(m[2]), want) ? m[1] : null;
}
