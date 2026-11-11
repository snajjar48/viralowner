import { notFound, withProject } from "@/lib/api";
import { getRender } from "@/lib/projects";
import { syncRender } from "@/lib/renders";

/** How a render is going (polled by the status page). */
export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/renders/[renderId]">) {
  return withProject(ctx.params, "Checking render", async (_userId, project) => {
    const { renderId } = await ctx.params;
    const render = await getRender(project.id, renderId);
    if (!render) return notFound();
    const r = await syncRender(project.id, render);
    return Response.json(
      { version: r.version, status: r.status, stage: r.stage, progress: r.progress, error: r.error },
      { headers: { "cache-control": "no-store" } },
    );
  });
}
