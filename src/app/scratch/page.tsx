import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FlowShell, PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import { BusinessPrompt } from "@/components/business-prompt";
import { getUserId } from "@/lib/auth";
import { getBusiness, hasBusiness } from "@/lib/business";
import { canStartVideo, canUseScratch, getMembership } from "@/lib/membership";
import { ManageBillingButton } from "../dashboard/manage-billing-button";
import { PromptStart } from "./prompt-start";

export const metadata: Metadata = {
  title: "start from scratch",
  robots: { index: false, follow: false },
};

// "Start from scratch" (Pro): describe the video, then add clips. No inspo.
export default function ScratchPage() {
  return (
    <FlowShell>
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Start />
      </Suspense>
    </FlowShell>
  );
}

async function Start() {
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/scratch");
  const m = await getMembership(userId);

  if (!canUseScratch(m)) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <span className="rounded-full bg-linear-to-r from-violet to-coral px-3 py-1 text-xs font-medium text-white">
          Pro
        </span>
        <PageTitle
          title="start from scratch is part of Pro"
          subtitle="upload your clips, describe the video you want in your own words, and we edit the whole thing for you. no inspo needed."
        />
        {m.plan?.tier === "basic" ? (
          <ManageBillingButton label="upgrade to Pro" />
        ) : (
          <Link href="/plans" className={`${buttonClass} flex max-w-sm items-center justify-center`}>
            choose Pro
          </Link>
        )}
        <Link href="/dashboard" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
          back to my videos
        </Link>
      </div>
    );
  }

  const can = canStartVideo(m);
  if ("reason" in can) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <PageTitle title="you’re out of videos for now" subtitle={can.message} />
        <Link href="/dashboard" className={`${buttonClass} flex max-w-sm items-center justify-center`}>
          back to my videos
        </Link>
      </div>
    );
  }

  return (
    <>
      <PageTitle
        title="what video do you have in mind?"
        subtitle="tell us like you’d tell an editor: what it’s for, what to show, the vibe, any words or effects you want. next you’ll add your clips."
      />
      {!hasBusiness(await getBusiness(userId)) && <BusinessPrompt />}
      <PromptStart />
    </>
  );
}
