import "server-only";

// Client for the processing worker on Modal (see worker/app.py).
// Every request carries the shared WORKER_TOKEN; the worker rejects anything else.

/** The worker's public address. Not a secret (requests still need the token). */
const DEFAULT_WORKER_URL = "https://snajjar48--viralowner-worker.us-east.modal.run";

export class WorkerError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

function config() {
  const token = process.env.WORKER_TOKEN;
  if (!token) throw new WorkerError("Worker is not configured (WORKER_TOKEN, see .env.example).", null);
  return { url: (process.env.WORKER_URL ?? DEFAULT_WORKER_URL).replace(/\/$/, ""), token };
}

export async function workerFetch<T>(
  path: string,
  { method = "GET", body, timeoutMs = 20_000 }: { method?: "GET" | "POST"; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const { url, token } = config();
  let res: Response;
  try {
    res = await fetch(`${url}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new WorkerError(`Worker unreachable: ${(error as Error).name}`, null);
  }
  if (!res.ok) throw new WorkerError(`Worker ${method} ${path} failed (${res.status})`, res.status);
  return (await res.json()) as T;
}

export interface WorkerHealth {
  ok: boolean;
  checks: Record<"ffmpeg" | "storage" | "claude", { ok: boolean; detail: string }>;
}

export const workerHealth = () => workerFetch<WorkerHealth>("/health", { timeoutMs: 60_000 });
