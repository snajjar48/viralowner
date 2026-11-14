import { jsonError, readJson, withProject } from "@/lib/api";
import { startClipUpload } from "@/lib/clips";
import { assignClip, getInspiration, isUuid, reorderClips, setClipMultiUse } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";
import { MAX_CLIPS } from "@/lib/video-files";

/** Adds a clip: returns the clip and where to upload it. */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/clips">) {
  return withProject(ctx.params, "Starting clip upload", async (userId, project) => {
    const body = await readJson(request);
    if (!body) return jsonError("invalid request.", 400);
    if (!(await checkRateLimit(`clips:${userId}`, 120))) {
      return jsonError("too many uploads in the last few minutes. please wait a bit and try again.", 429);
    }
    const result = await startClipUpload(userId, project.id, body);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json(result);
  });
}

/**
 * Saves the clip order ({ order: [ids] }), one assignment ({ assign: { clipId, shotIndex, on } }: a clip
 * can be on several shots; `on: false` takes it off that one, shotIndex null off all), or whether a
 * "start from scratch" clip is cut into several shots ({ multiUse: { clipId, on } }).
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]/clips">) {
  return withProject(ctx.params, "Updating clips", async (userId, project) => {
    const body = await readJson(request);
    if (!body) return jsonError("invalid request.", 400);

    if (Array.isArray(body.order)) {
      const ids = body.order.filter(isUuid);
      if (ids.length !== body.order.length || ids.length > MAX_CLIPS * 2) return jsonError("invalid order.", 400);
      await reorderClips(project.id, ids);
    }

    if (body.assign && typeof body.assign === "object") {
      const { clipId, shotIndex, on } = body.assign as Record<string, unknown>;
      if (!isUuid(clipId)) return jsonError("invalid clip.", 400);
      if (shotIndex !== null) {
        const shots = (await getInspiration(userId, project.id))?.breakdown?.shotCount ?? 0;
        if (typeof shotIndex !== "number" || !Number.isInteger(shotIndex) || shotIndex < 0 || shotIndex >= shots) {
          return jsonError("that shot doesn’t exist.", 400);
        }
      }
      await assignClip(project.id, clipId, shotIndex as number | null, on !== false);
    }

    if (body.multiUse && typeof body.multiUse === "object") {
      const { clipId, on } = body.multiUse as Record<string, unknown>;
      if (!isUuid(clipId) || typeof on !== "boolean") return jsonError("invalid clip.", 400);
      try {
        await setClipMultiUse(project.id, clipId, on);
      } catch (error) {
        console.error("Saving clip multi-use failed:", error);
        return jsonError("couldn’t save that right now. please try again later.", 503);
      }
    }
    return Response.json({ ok: true });
  });
}
