import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlowShell, PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import { InspoUploader } from "@/components/inspo-uploader";
import { BusinessPrompt } from "@/components/business-prompt";
import { FirstTimeTip } from "@/components/first-time-tip";
import { onboardingOf } from "@/lib/onboarding";
import { getUser } from "@/lib/auth";
import { getBusiness, hasBusiness } from "@/lib/business";
import { canStartVideo, getMembership } from "@/lib/membership";

export const metadata: Metadata = {
  title: "new video",
  robots: { index: false, follow: false },
};

// Step 1: upload the inspo. Requires a signed-in account (src/proxy.ts).
export default function NewVideoPage() {
  return (
    <FlowShell step={1}>
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Start />
      </Suspense>
    </FlowShell>
  );
}

async function Start() {
  const user = await getUser();
  const userId = user?.id ?? null;
  const can = userId ? canStartVideo(await getMembership(userId)) : null;
  if (can && "reason" in can) {
    return (
      <div className="flex flex-col items-center gap-5 text-center">
        <PageTitle title="you’re out of videos for now" subtitle={can.message} />
        <Link href={can.reason === "subscribe" ? "/plans" : "/dashboard"} className={`${buttonClass} flex max-w-sm items-center justify-center`}>
          {can.reason === "subscribe" ? "choose a plan" : "back to dashboard"}
        </Link>
      </div>
    );
  }
  return (
    <>
      <PageTitle
        title={can?.as === "trial" ? "let’s make your free video" : "which video do you want to recreate?"}
        subtitle="upload a video you love. we’ll break down every shot so you can film your own spin on it."
      />
      <FirstTimeTip id="inspo" title="start with a video you love">
        <p>
          pick a viral video in a style you could film yourself: the same kind of place, props and people. save it to
          your phone first, then upload it here.
        </p>
        <p>not sure how to save one? open “how do i get a video from TikTok or Instagram?” below.</p>
      </FirstTimeTip>
      {userId && !hasBusiness(await getBusiness(userId)) && <BusinessPrompt />}
      <InspoUploader category={onboardingOf(user).category} />
    </>
  );
}
