import { jsonError, withProject } from "@/lib/api";
import { businessText, getBusiness } from "@/lib/business";
import { getHookJob, startHookJob } from "@/lib/processing/modal";
import { getInspiration, listClips } from "@/lib/projects";
import { checkRateLimit } from "@/lib/rate-limit";

/** Starts a hook check: the first thing said in the project's clips, judged as a hook. Free. */
export async function POST(_request: Request, ctx: RouteContext<"/api/projects/[id]/hook">) {
  return withProject(ctx.params, "Starting hook check", async (userId, project) => {
    if (!(await checkRateLimit(`hook:${userId}`, 10))) {
      return jsonError("you’ve checked a lot of hooks in the last few minutes. please wait a bit and try again.", 429);
    }
    const clips = (await listClips(userId, project.id)).filter((c) => c.status === "uploaded");
    if (!clips.length) return jsonError("add your clips first.", 400);
    const inspo = project.kind === "scratch" ? null : await getInspiration(userId, project.id);
    const about =
      project.kind === "scratch"
        ? project.prompt
        : [inspo?.breakdown?.insights?.hook, inspo?.breakdown?.insights?.structure].filter(Boolean).join(" ");
    const { jobId } = await startHookJob({
      clips: clips.map((c) => ({ storageKey: c.storageKey })),
      about: (about ?? "").slice(0, 800),
      business: businessText(await getBusiness(userId)),
    });
    return Response.json({ jobId });
  });
}

/** ?job=…: how the check is going, and its answer when it's done. */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/hook">) {
  return withProject(ctx.params, "Checking hook", async () => {
    const jobId = new URL(request.url).searchParams.get("job") ?? "";
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(jobId)) return jsonError("invalid request.", 400);
    return Response.json(await getHookJob(jobId));
  });
}
