import { Suspense, type ReactNode } from "react";
import { getUserId } from "@/lib/auth";
import { touchProject } from "@/lib/projects";

/** Every project page: opening it counts as activity (untouched drafts are cleaned up). */
export default function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      {children}
      <Suspense fallback={null}>
        <Opened params={params} />
      </Suspense>
    </>
  );
}

async function Opened({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, userId] = await Promise.all([params, getUserId()]);
  if (userId) await touchProject(userId, id).catch((error) => console.error("Marking project opened failed:", error));
  return null;
}
