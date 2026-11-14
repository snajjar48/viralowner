import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FlowShell, PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import { InspoUploader } from "@/components/inspo-uploader";
import { BusinessPrompt } from "@/components/business-prompt";
import { getUserId } from "@/lib/auth";
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
  const userId = await getUserId();
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
      {userId && !hasBusiness(await getBusiness(userId)) && <BusinessPrompt />}
      <InspoUploader />
    </>
  );
}
