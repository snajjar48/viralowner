import type { Metadata } from "next";
import { FlowShell, PageTitle } from "@/components/flow-shell";
import { InspoUploader } from "@/components/inspo-uploader";

export const metadata: Metadata = {
  title: "viralowner — new video",
  robots: { index: false, follow: false },
};

// Step 1: upload the inspo. Requires a signed-in account (src/proxy.ts).
export default function NewVideoPage() {
  return (
    <FlowShell step={1}>
      <PageTitle
        title="which video do you want to recreate?"
        subtitle="upload a video you love. we’ll break down every shot so you can film your own spin on it."
      />
      <InspoUploader />
    </FlowShell>
  );
}
