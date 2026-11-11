import "server-only";
import { notFound, redirect } from "next/navigation";
import { getUserId } from "./auth";
import { getProject } from "./projects";

/**
 * For project pages: the signed-in user and their project, or a redirect to
 * login / a 404 (also for other people's projects).
 */
export async function loadProject(projectId: string, path: string) {
  const userId = await getUserId();
  if (!userId) redirect(`/login?next=${encodeURIComponent(path)}`);
  const project = await getProject(userId, projectId);
  if (!project) notFound();
  return { userId, project };
}
