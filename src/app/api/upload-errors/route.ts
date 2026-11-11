import { readJson } from "@/lib/api";
import { getUserId } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Browsers report failed direct-to-storage uploads here, so they show up in
 * the server logs (storage itself never tells us). Logs only; no reply needed.
 */
export async function POST(request: Request) {
  try {
    const userId = await getUserId();
    if (!userId || !(await checkRateLimit(`upload-error:${userId}`, 30))) return new Response(null, { status: 204 });
    const body = (await readJson(request)) ?? {};
    console.error("Browser upload failed:", {
      userId,
      kind: str(body.kind, 20),
      status: num(body.status),
      fileType: str(body.fileType, 60),
      fileExt: str(body.fileExt, 10),
      sizeBytes: num(body.sizeBytes),
      loadedBytes: num(body.loadedBytes),
      elapsedMs: num(body.elapsedMs),
      online: body.online === true,
      userAgent: str(request.headers.get("user-agent"), 300),
    });
  } catch (error) {
    console.error("Logging upload error failed:", error);
  }
  return new Response(null, { status: 204 });
}
