import { notFound, withProject } from "@/lib/api";
import { getRender } from "@/lib/projects";
import { createDownloadUrl } from "@/lib/storage";

/**
 * A finished video's file: redirects to a freshly signed storage link, so a page
 * left open never ends up with an expired one. `?download=1` saves it as a file
 * instead of playing it.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/renders/[renderId]/file">) {
  return withProject(ctx.params, "Opening video file", async (_userId, project) => {
    const { renderId } = await ctx.params;
    const render = await getRender(project.id, renderId);
    if (!render || render.status !== "done" || !render.storageKey) return notFound();
    const download = new URL(request.url).searchParams.get("download") === "1";
    const url = await createDownloadUrl(render.storageKey, {
      expiresIn: 3600,
      downloadName: download ? `viralowner-video-v${render.version}.mp4` : undefined,
    });
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
  });
}
