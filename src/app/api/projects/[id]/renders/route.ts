import { jsonError, readJson, withProject } from "@/lib/api";
import { listRenders, saveSettings } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";
import { getStillActiveRender, newSeed, parseShotEdits, settingsFor, shotsFromAssignments, startNewRender } from "@/lib/renders";
import { parseVideoOptions } from "@/lib/video-options";

/**
 * Makes a new version of the video.
 *   { mode: "new", options }                 from step 3 (uses the step 2 assignments)
 *   { mode: "edit", options, shots }         from the preview editor
 *   { mode: "regenerate", fromVersion }      a fresh take on an existing version
 */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/renders">) {
  return withProject(ctx.params, "Starting render", async (userId, project) => {
    const body = await readJson(request);
    if (!body) return jsonError("invalid request.", 400);

    const active = await getStillActiveRender(project.id);
    if (active) {
      return Response.json(
        { error: `version ${active.version} is still being made. wait for it to finish first.`, renderId: active.id },
        { status: 409 },
      );
    }
    if (!(await checkRateLimit(`renders:${userId}`, 20))) {
      return jsonError("you’ve made a lot of versions in the last few minutes. please wait a bit and try again.", 429);
    }

    let result;
    if (body.mode === "new" || body.mode === "edit") {
      const options = parseVideoOptions(body.options);
      if ("error" in options) return jsonError(options.error, 400);
      if (body.mode === "new") await saveSettings(project.id, options);
      result = await startNewRender(userId, project, ({ shotCount, clips }) => {
        if (body.mode === "new") return settingsFor(options, shotsFromAssignments(shotCount, clips));
        const shots = parseShotEdits(body.shots, shotCount, clips);
        return "error" in shots ? shots : settingsFor(options, shots);
      });
    } else if (body.mode === "regenerate") {
      const from = (await listRenders(userId, project.id)).find((r) => r.version === body.fromVersion);
      if (!from) return jsonError("we couldn’t find that version.", 404);
      result = await startNewRender(userId, project, () => ({ ...from.settings, seed: newSeed() }));
    } else {
      return jsonError("invalid request.", 400);
    }

    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json({ renderId: result.render.id, version: result.render.version });
  });
}
