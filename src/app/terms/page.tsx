import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth-shell";
import { CHANGES_PER_VIDEO, TRIAL_CHANGES, VIDEO_LIMITS } from "@/lib/plan-format";

export const metadata: Metadata = pageMetadata({
  title: "terms and conditions",
  description: "viralowner’s terms: the free trial, memberships, changing or cancelling your plan, and your content.",
  path: "/terms",
  index: false,
});

// Billing terms in plain words. Have a lawyer review these (and add the rest
// of the terms) before launch.
export default function TermsPage() {
  return (
    <AuthShell title="Terms and conditions">
      <div className="flex flex-col gap-8 text-sm text-muted text-pretty">
        <Part title="Free trial">
          <p>
            The free trial includes 1 video, {TRIAL_CHANGES} change to that video, and downloading it. You need to
            add a card to start the trial. We save the card with our payment provider, Stripe, and{" "}
            <strong className="text-foreground">we don’t charge it</strong>.
          </p>
          <p>
            The trial never turns into a paid membership on its own. You’re only charged if you choose a plan,
            agree to these terms and press the subscribe button. One free trial per person and per card.
          </p>
        </Part>

        <Part title="Memberships">
          <p>
            Basic includes {VIDEO_LIMITS.basic} videos a month. Pro includes up to {VIDEO_LIMITS.pro} videos a
            month. Each video includes up to {CHANGES_PER_VIDEO} changes (a change request, an edit or a
            regenerate). If a video fails to make, trying again is free and doesn’t use a change.
          </p>
          <p>
            Monthly plans are charged when you subscribe and then every month. Yearly plans are charged when you
            subscribe and then every year. Videos reset every month on the day you subscribed, on yearly plans
            too. Unused videos don’t carry over. Your free trial video doesn’t count toward your monthly videos.
          </p>
          <p>We never charge you extra for going over your videos. You can upgrade instead.</p>
        </Part>

        <Part title="Changing or cancelling">
          <p>
            You can switch plans, update your card or cancel anytime from your dashboard under “manage billing”.
            When you cancel, your membership stays active until the end of the period you paid for, then stops.
            You won’t be charged again.
          </p>
        </Part>

        <Part title="Your content">
          <p>
            You confirm you have the rights to the clips, inspiration videos and audio you upload, as you agree
            to when you upload them. You’re responsible for how you use the videos we make.
          </p>
        </Part>

        <p>
          Questions? Email{" "}
          <a href="mailto:hello@viralowner.com" className="text-foreground underline underline-offset-4">
            hello@viralowner.com
          </a>
          .
        </p>
      </div>
    </AuthShell>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      {children}
    </section>
  );
}
