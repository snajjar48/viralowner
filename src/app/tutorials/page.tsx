import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageTitle } from "@/components/flow-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { getUserId } from "@/lib/auth";
import { Tutorials } from "./tutorials";

export const metadata: Metadata = {
  title: "tutorials",
  robots: { index: false, follow: false },
};

export default function TutorialsPage() {
  return (
    <FlowShell width="wide">
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Page />
      </Suspense>
    </FlowShell>
  );
}

async function Page() {
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/tutorials");
  return (
    <>
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
      >
        <ArrowLeftIcon className="size-4" /> dashboard
      </Link>
      <PageTitle
        title="tutorials"
        subtitle="step by step, with what to tap on each screen. for ideas and filming advice, see the tips."
      />
      <Tutorials />
      <p className="text-center text-sm text-muted">
        want advice on ideas, filming and hooks?{" "}
        <Link href="/tips" className="text-foreground underline underline-offset-4">
          read the tips
        </Link>
      </p>
    </>
  );
}
