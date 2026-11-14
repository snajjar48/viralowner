import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BusinessForm } from "@/components/business-form";
import { FlowShell, PageTitle } from "@/components/flow-shell";
import { ArrowLeftIcon } from "@/components/icons";
import { getUserId } from "@/lib/auth";
import { EMPTY_BUSINESS, getBusiness } from "@/lib/business";

export const metadata: Metadata = {
  title: "viralowner — your profile",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return (
    <FlowShell>
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Profile />
      </Suspense>
    </FlowShell>
  );
}

async function Profile() {
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/profile");
  const profile = (await getBusiness(userId)) ?? EMPTY_BUSINESS;
  return (
    <>
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
      >
        <ArrowLeftIcon className="size-4" /> dashboard
      </Link>
      <PageTitle
        title="your profile"
        subtitle="we use this on every video you make: your names and products spelled right, text and post captions that sound like you, and the things you asked us to remember."
      />
      <BusinessForm initial={profile} submitLabel="save my profile" />
    </>
  );
}
