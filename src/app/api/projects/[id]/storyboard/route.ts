import { jsonError, readJson, withProject } from "@/lib/api";
import { saveSettings } from "@/lib/projects";
import { getStoryboardJob } from "@/lib/processing/modal";
import { checkRateLimit } from "@/lib/rate-limit";
import { startStoryboard } from "@/lib/renders";
import { createDownloadUrl } from "@/lib/storage";
import { inspoOptions, parseVideoOptions } from "@/lib/video-options";

/** { options }: plans the first version and draws a frame per shot (no video, nothing used up). */
export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/storyboard">) {
  return withProject(ctx.params, "Starting storyboard", async (userId, project) => {
    if (project.kind === "scratch") return jsonError("the storyboard is for remakes.", 400);
    if (!(await checkRateLimit(`storyboard:${userId}`, 12))) {
      return jsonError("you’ve made a lot of previews in the last few minutes. please wait a bit and try again.", 429);
    }
    const parsed = parseVideoOptions((await readJson(request))?.options);
    if ("error" in parsed) return jsonError(parsed.error, 400);
    const options = inspoOptions(parsed);
    await saveSettings(project.id, options);
    const result = await startStoryboard(userId, project, options);
    if ("error" in result) return jsonError(result.error, result.status);
    return Response.json({ jobId: result.jobId });
  });
}

/** ?job=…: how the storyboard is going, and its frames when it's done. */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/storyboard">) {
  return withProject(ctx.params, "Checking storyboard", async (_userId, project) => {
    const jobId = new URL(request.url).searchParams.get("job") ?? "";
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(jobId)) return jsonError("invalid request.", 400);
    const job = await getStoryboardJob(jobId);
    if (job.state !== "done" || !job.result) return Response.json({ state: job.state, progress: job.progress, error: job.error });
    // Only this project's frames.
    const folder = /^u\/[^/]+\/p\/([^/]+)\//.exec(job.result.frames[0].key);
    if (folder?.[1] !== project.id) return jsonError("we couldn’t find that preview.", 404);
    const frames = await Promise.all(
      job.result.frames.map(async (f, i) => ({
        index: i,
        durationS: f.durationS,
        text: f.text,
        url: await createDownloadUrl(f.key, { expiresIn: 3600 }),
      })),
    );
    return Response.json({ state: "done", progress: 100, frames });
  });
}
