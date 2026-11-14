import { randomUUID } from "node:crypto";
import { jsonError, readJson, withProject } from "@/lib/api";
import { checkRateLimit } from "@/lib/rate-limit";
import { createUploadUrl } from "@/lib/storage";

const PROOF_MAX_BYTES = 15 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** { contentType, sizeBytes }: where to upload a proof screenshot (it's added to the video in a second step). */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/proofs">) {
  return withProject(ctx.params, "Starting proof upload", async (userId, project) => {
    if (!(await checkRateLimit(`proofs:${userId}`, 30))) {
      return jsonError("that’s a lot of screenshots. please wait a bit and try again.", 429);
    }
    const body = await readJson(request);
    const type = typeof body?.contentType === "string" ? body.contentType.toLowerCase() : "";
    const size = typeof body?.sizeBytes === "number" ? body.sizeBytes : 0;
    if (!TYPES[type]) return jsonError("add a PNG, JPG or WebP screenshot.", 400);
    if (size <= 0 || size > PROOF_MAX_BYTES) return jsonError("screenshots need to be 15 MB or less.", 400);
    const key = `u/${userId}/p/${project.id}/proofs/${randomUUID()}.${TYPES[type]}`;
    const upload = await createUploadUrl(key, { contentType: type, sizeBytes: size });
    return Response.json({ key, upload });
  });
}
