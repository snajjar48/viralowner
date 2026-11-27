"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BusinessForm, type BusinessValues } from "@/components/business-form";
import { CategoryPicker } from "@/components/category-picker";
import { PageTitle } from "@/components/flow-shell";
import { buttonClass } from "@/components/form";
import type { VideoCategory } from "@/lib/categories";

async function save(body: { category?: VideoCategory | null; done?: boolean }) {
  // Best effort: the setup only saves time later, so a failed save never blocks anyone.
  await fetch("/api/onboarding", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
}

/** Two quick, skippable steps: the kind of videos they make, then the essentials about their business. */
export function WelcomeSteps({
  firstName,
  category: initialCategory,
  business,
}: {
  firstName: string;
  category: VideoCategory | null;
  business: BusinessValues;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [category, setCategory] = useState<VideoCategory | null>(initialCategory);
  const [busy, setBusy] = useState(false);

  async function next() {
    setBusy(true);
    await save({ category });
    setBusy(false);
    setStep(2);
    window.scrollTo({ top: 0 });
  }

  async function finish() {
    setBusy(true);
    await save({ done: true });
    router.push("/dashboard");
    router.refresh();
  }

  const skip = (
    <button
      type="button"
      onClick={step === 1 ? () => setStep(2) : finish}
      disabled={busy}
      className="w-fit cursor-pointer self-center text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
    >
      {step === 1 ? "skip" : "skip for now"}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs font-medium tracking-wide text-muted uppercase">step {step} of 2</p>
      {step === 1 ? (
        <>
          <PageTitle
            title={firstName ? `welcome, ${firstName}! what kind of videos do you make?` : "welcome! what kind of videos do you make?"}
            subtitle="each kind gets its own editing style. we’ll pick it for you when you start a video, and you can change it any time."
          />
          <CategoryPicker value={category} onChange={setCategory} disabled={busy} label="pick the one you make most" optional={false} />
          <button type="button" onClick={next} disabled={busy || !category} className={`${buttonClass} disabled:opacity-50`}>
            {busy ? "saving…" : "continue"}
          </button>
          {skip}
        </>
      ) : (
        <>
          <PageTitle
            title="tell us about your business"
            subtitle="so your first video gets your name, products and audience right. it takes a minute, and you can add more on your profile later."
          />
          <BusinessForm initial={business} short submitLabel="save and continue" onSaved={finish} />
          {skip}
        </>
      )}
    </div>
  );
}
