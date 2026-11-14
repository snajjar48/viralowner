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
  title: "viralowner — your business",
  robots: { index: false, follow: false },
};

export default function BusinessPage() {
  return (
    <FlowShell>
      <Suspense fallback={<p className="text-center text-muted">Loading…</p>}>
        <Business />
      </Suspense>
    </FlowShell>
  );
}

async function Business() {
  const userId = await getUserId();
  if (!userId) redirect("/login?next=/business");
  const business = (await getBusiness(userId)) ?? EMPTY_BUSINESS;
  return (
    <>
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-coral"
      >
        <ArrowLeftIcon className="size-4" /> dashboard
      </Link>
      <PageTitle
        title="your business"
        subtitle="used on every video: captions and text spell your names and products your way, and post captions know what you sell."
      />
      <BusinessForm initial={business} />
    </>
  );
}
