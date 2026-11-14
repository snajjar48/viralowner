import { jsonError, readJson, withProject } from "@/lib/api";
import { canUseScratch, claimRender, getMembership, SCRATCH_PRO_MESSAGE } from "@/lib/membership";
import { listClips, listRenders, saveSettings, type Project } from "@/lib/projects";
import { getStoryboardJob } from "@/lib/processing/modal";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  carryFrom,
  getStillActiveRender,
  newSeed,
  parseShotEdits,
  settingsFor,
  shotsFromAssignments,
  previousFor,
  startNewRender,
  startScratchRender,
  textToReuse,
} from "@/lib/renders";
import { inspoOptions, parseVideoOptions, REQUEST_MAX, scratchOptions } from "@/lib/video-options";

/**
 * Makes a new version of the video.
 *   { mode: "new", options }                 from step 3 (uses the step 2 assignments)
 *   { mode: "edit", options, shots, fromVersion, request? }  from the preview editor. Keeps that
 *                                            version's words if the text options didn't change;
 *                                            `request` is a typed "request a change" for that version.
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
    if (project.kind === "scratch" && !canUseScratch(await getMembership(userId))) {
      return Response.json({ error: SCRATCH_PRO_MESSAGE, reason: "pro" }, { status: 402 });
    }
    // Fixing caption words remakes the same edit: it doesn't use up a change.
    if (body.mode === "captions") return fixCaptions(userId, project, body);

    // Counts the video against the trial or plan on its first version, and
    // checks this video still has changes left otherwise.
    const claim = await claimRender(userId, project);
    if ("reason" in claim) return Response.json({ error: claim.message, reason: claim.reason }, { status: claim.status });

    try {
      const response = await (project.kind === "scratch" ? makeScratchVersion : makeVersion)(userId, project, body);
      if (!response.ok) await claim.release();
      return response;
    } catch (error) {
      await claim.release();
      throw error;
    }
  });
}

async function makeVersion(userId: string, project: Project, body: Record<string, unknown>) {
  let result;
  if (body.mode === "new" && typeof body.storyboard === "string") {
    // The first version, exactly as the storyboard showed it.
    const parsed = parseVideoOptions(body.options);
    if ("error" in parsed) return jsonError(parsed.error, 400);
    const options = inspoOptions(parsed);
    const job = /^[A-Za-z0-9_-]{1,100}$/.test(body.storyboard) ? await getStoryboardJob(body.storyboard) : null;
    if (job?.state !== "done" || !job.result) return jsonError("that preview expired. make a new one, or just make your video.", 400);
    const { plan, postCopy } = job.result;
    await saveSettings(project.id, options);
    result = await startNewRender(
      userId,
      project,
      ({ shotCount, clips }) => {
        const shots = parseShotEdits(plan.shots, shotCount, clips);
        if ("error" in shots) return shots;
        return settingsFor(options, shots);
      },
      {
        reuseText: {
          texts: plan.texts,
          textPosition: plan.textPosition,
          textLook: plan.textLook,
          textXs: plan.textXs,
          textYs: plan.textYs,
          captionYs: plan.captionYs,
          textScale: plan.textScale,
          captionScale: plan.captionScale,
          textStyle: plan.textStyle,
          textPreset: plan.textPreset,
          keepLines: plan.keepLines,
          postCopy,
        },
        cuts: plan.jumpcut,
        effects: plan.effects,
        writePost: true,
      },
    );
  } else if (body.mode === "new" || body.mode === "edit") {
    const parsed = parseVideoOptions(body.options);
    if ("error" in parsed) return jsonError(parsed.error, 400);
    const options = inspoOptions(parsed);
    if (body.mode === "new") await saveSettings(project.id, options);
    const from =
      body.mode === "edit"
        ? (await listRenders(userId, project.id)).find((r) => r.version === body.fromVersion && r.status === "done")
        : undefined;
    const request = body.mode === "edit" && typeof body.request === "string" ? body.request.trim() : "";
    if (request.length > REQUEST_MAX) return jsonError(`your request can be up to ${REQUEST_MAX} characters.`, 400);
    const previous = request && from ? previousFor(from, options) : null;
    if (request && !previous) {
      return jsonError("this version can’t take requests. tap regenerate to make a new one, then ask again.", 400);
    }
    result = await startNewRender(
      userId,
      project,
      ({ shotCount, clips }) => {
        if (body.mode === "new") return settingsFor(options, shotsFromAssignments(shotCount, clips));
        const shots = parseShotEdits(body.shots, shotCount, clips);
        if ("error" in shots) return shots;
        return {
          ...settingsFor(options, shots),
          ...carryFrom(from),
          ...(request ? { request, fromVersion: from!.version } : {}),
        };
      },
      // One-take videos keep where the take was cut, unless it's a fresh take. Edits keep the
      // version's transitions and effects (a request can change them).
      {
        ...(previous ? { request, previous } : { reuseText: textToReuse(from, options) }),
        cuts: from?.plan?.jumpcut,
        effects: from?.plan?.effects,
      },
    );
  } else if (body.mode === "regenerate") {
    const from = (await listRenders(userId, project.id)).find((r) => r.version === body.fromVersion);
    if (!from) return jsonError("we couldn’t find that version.", 404);
    result = await startNewRender(userId, project, () => ({ ...from.settings, ...carryFrom(from), seed: newSeed() }), {
      fresh: true,
    });
  } else {
    return jsonError("invalid request.", 400);
  }

  if ("error" in result) return jsonError(result.error, result.status);
  return Response.json({ renderId: result.render.id, version: result.render.version });
}

function captionEditFrom(body: Record<string, unknown>, from: { plan: { captionText?: string } | null }) {
  const after = typeof body.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  const before = (from.plan?.captionText ?? "").replace(/\s+/g, " ").trim();
  if (!after || !before) return { error: "there are no captions to fix in this version." };
  if (after.length > 5000) return { error: "that’s too long." };
  if (after === before) return { error: "change a word first." };
  return { before, after };
}

/** { mode: "captions", fromVersion, text }: the same version again, with the captions' words as the user typed them. */
async function fixCaptions(userId: string, project: Project, body: Record<string, unknown>) {
  const from = (await listRenders(userId, project.id)).find((r) => r.version === body.fromVersion && r.status === "done");
  if (!from?.plan) return jsonError("we couldn’t find that version.", 404);
  const edit = captionEditFrom(body, from);
  if ("error" in edit) return jsonError(edit.error!, 400);
  const carried = carryFrom(from).carry ?? {};
  const carry = { carry: { ...carried, captionEdit: edit } };
  const shots = from.plan.shots;
  let result;
  if (project.kind === "scratch") {
    const previous = previousFor(from, from.settings.options);
    if (!previous) return jsonError("we couldn’t find that version.", 404);
    result = await startScratchRender(
      userId,
      project,
      { ...settingsFor(from.settings.options, shots), ...carry, fromVersion: from.version },
      { previous },
    );
  } else {
    const options = from.settings.options;
    result = await startNewRender(userId, project, () => ({ ...settingsFor(options, shots), ...carry }), {
      reuseText: textToReuse(from, options),
      cuts: from.plan.jumpcut,
      effects: from.plan.effects,
    });
  }
  if ("error" in result) return jsonError(result.error, result.status);
  return Response.json({ renderId: result.render.id, version: result.render.version });
}

/**
 * "Start from scratch" versions. We plan the edit from the prompt and clips:
 *   new: the first version. edit: from a version, with the user's shot edits and/or a request
 *   (the worker rebuilds that version, or asks Claude for the change). regenerate: a fresh take.
 */
async function makeScratchVersion(userId: string, project: Project, body: Record<string, unknown>) {
  let result;
  if (body.mode === "new" || body.mode === "edit") {
    const parsed = parseVideoOptions(body.options);
    if ("error" in parsed) return jsonError(parsed.error, 400);
    const options = scratchOptions(parsed);
    if (body.mode === "new") {
      await saveSettings(project.id, options);
      result = await startScratchRender(userId, project, settingsFor(options, []));
    } else {
      const from = (await listRenders(userId, project.id)).find((r) => r.version === body.fromVersion && r.status === "done");
      const previous = from && previousFor(from, options);
      if (!from || !previous) return jsonError("we couldn’t find that version. tap regenerate to make a new one.", 400);
      const request = typeof body.request === "string" ? body.request.trim() : "";
      if (request.length > REQUEST_MAX) return jsonError(`your request can be up to ${REQUEST_MAX} characters.`, 400);
      const uploaded = (await listClips(userId, project.id)).filter((c) => c.status === "uploaded");
      const shots = parseShotEdits(body.shots, from.plan?.shots.length ?? 0, uploaded);
      if ("error" in shots) return jsonError(shots.error, shots.status);
      result = await startScratchRender(
        userId,
        project,
        { ...settingsFor(options, shots), ...carryFrom(from), fromVersion: from.version, ...(request ? { request } : {}) },
        { previous, ...(request ? { request } : {}) },
      );
    }
  } else if (body.mode === "regenerate") {
    const from = (await listRenders(userId, project.id)).find((r) => r.version === body.fromVersion);
    if (!from) return jsonError("we couldn’t find that version.", 404);
    result = await startScratchRender(userId, project, { ...settingsFor(scratchOptions(from.settings.options), []), ...carryFrom(from) }, {
      fresh: true,
    });
  } else {
    return jsonError("invalid request.", 400);
  }
  if ("error" in result) return jsonError(result.error, result.status);
  return Response.json({ renderId: result.render.id, version: result.render.version });
}
