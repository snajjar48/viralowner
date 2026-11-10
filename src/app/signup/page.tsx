import type { Metadata } from "next";
import Link from "next/link";
import { AuthLayout, EditPreview, Eyebrow, GradientText } from "@/components/auth-layout";
import { getPlans } from "@/lib/plans";
import { ClockIcon, SparkleIcon, TrendIcon, UploadIcon, WandIcon } from "@/components/icons";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "viralowner — create your account",
  robots: { index: false, follow: false },
};

const BENEFITS = [
  {
    icon: SparkleIcon,
    title: "Your spin, not a copy",
    body: "We take the formats that are already going viral and make them unmistakably yours: your brand, your voice, your vibe.",
  },
  {
    icon: ClockIcon,
    title: "Hours back, every week",
    body: "No timelines, no keyframes, no late nights in an editor. Send raw clips and get back finished edits.",
  },
  {
    icon: TrendIcon,
    title: "Built to get the views",
    body: "Every edit is shaped around what keeps people watching, so your content competes with the best on the feed.",
  },
];

const STEPS = [
  { icon: UploadIcon, label: "Upload your raw clips" },
  { icon: WandIcon, label: "We edit them into a viral format" },
  { icon: TrendIcon, label: "You post and watch the views roll in" },
];

function Pitch() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <Eyebrow>for business owners &amp; creators</Eyebrow>
        <h2 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
          your spin. <GradientText>viral reach.</GradientText> zero editing.
        </h2>
        <p className="max-w-lg text-lg text-muted text-pretty">
          Put your own twist on the videos everyone’s watching, without losing hours to editing.
          Get just as many views with viralowner.
        </p>
      </div>

      <div className="hidden sm:block">
        <EditPreview />
      </div>

      <ul className="hidden flex-col gap-5 sm:flex">
        {BENEFITS.map(({ icon: Icon, title, body }) => (
          <li key={title} className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5">
              <Icon className="size-5 text-coral" />
            </span>
            <div>
              <p className="font-medium">{title}</p>
              <p className="mt-1 text-sm text-muted text-pretty">{body}</p>
            </div>
          </li>
        ))}
      </ul>

      <ol className="hidden flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-5 lg:flex">
        <p className="text-xs font-medium tracking-wide text-muted uppercase">How it works</p>
        {STEPS.map(({ icon: Icon, label }, i) => (
          <li key={label} className="flex items-center gap-3 text-sm">
            <span className="flex size-7 items-center justify-center rounded-full bg-linear-to-r from-violet to-coral text-xs font-semibold text-white">
              {i + 1}
            </span>
            <Icon className="size-4 text-muted" />
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export default async function SignupPage() {
  const plans = await getPlans();
  return (
    <AuthLayout
      aside={<Pitch />}
      title="Create your account"
      subtitle={
        <>
          Takes about 2 minutes. Already a member?{" "}
          <Link href="/login" className="whitespace-nowrap text-foreground underline underline-offset-4">
            Log in
          </Link>
        </>
      }
    >
      <SignupForm plans={plans} />
    </AuthLayout>
  );
}
