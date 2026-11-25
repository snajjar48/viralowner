import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { AuthShell } from "@/components/auth-shell";
import { Effective, Email, List, PageLink, Part } from "@/components/legal";
import { LEGAL } from "@/content/legal";
import { CHANGES_PER_VIDEO, TRIAL_CHANGES, VIDEO_LIMITS } from "@/lib/plan-format";

export const metadata: Metadata = pageMetadata({
  title: "terms and conditions",
  description: "viralowner’s terms: the free trial, memberships, cancelling, your content and how you can use viralowner.",
  path: "/terms",
  index: false,
});

// Written in plain words. Fill in the placeholders in content/legal.ts and have a lawyer
// review this page before launch.
export default function TermsPage() {
  return (
    <AuthShell title="Terms and conditions" wide>
      <div className="flex flex-col gap-8 text-sm text-muted text-pretty">
        <Effective />

        <Part title="These terms">
          <p>
            viralowner is run by {LEGAL.company} (“viralowner”, “we”, “us”). These terms are an agreement between you
            and us. By creating an account, joining the waitlist, uploading anything or subscribing, you agree to
            them and to our <PageLink href="/privacy">privacy policy</PageLink>. If you don’t agree, please don’t use
            viralowner.
          </p>
        </Part>

        <Part title="Who can use viralowner">
          <p>
            You must be at least 18 years old and able to enter a binding agreement. If you use viralowner for a
            business, you confirm you’re allowed to accept these terms for it, and “you” includes that business.
          </p>
          <p>
            Keep your password safe. You’re responsible for everything done with your account. Tell us right away
            at <Email /> if you think someone else is using it.
          </p>
        </Part>

        <Part title="What viralowner does">
          <p>
            You upload a video to use as a style reference (or describe an idea) and your own clips. Our software,
            including AI, edits your clips into a new video and suggests a caption and hashtags. You can ask for
            changes and download the result.
          </p>
          <p>
            AI can make mistakes: it can cut the wrong moment, misspell or misplace text, or write a caption that
            isn’t right for you. <strong className="text-foreground">Watch every video and read every caption before
            you post it.</strong> You decide what you publish.
          </p>
          <p>
            We keep improving viralowner, so features can change, and we may add, change or remove them. We aim to
            keep it running at all times but can’t promise it will always be available or error free.
          </p>
        </Part>

        <Part title="No guaranteed results">
          <p>
            Following the format of a video that went viral doesn’t mean yours will. Views, followers, sales and
            engagement depend on many things outside our control, including each platform’s algorithm.{" "}
            <strong className="text-foreground">
              We don’t guarantee any number of views or any other result.
            </strong>
          </p>
        </Part>

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
            Basic includes {VIDEO_LIMITS.basic} videos a month, Plus {VIDEO_LIMITS.plus} and Pro {VIDEO_LIMITS.pro}. Plus and Pro
            also include start from scratch. Each video includes up to {CHANGES_PER_VIDEO} changes (a change request, an edit or a
            regenerate). If a video fails to make, trying again is free and doesn’t use a change.
          </p>
          <p>
            Monthly plans are charged when you subscribe and then every month. Yearly plans are charged when you
            subscribe and then every year. Your membership renews automatically at the price shown when you
            subscribed until you cancel. Videos reset every month on the day you subscribed, on yearly plans too.
            Unused videos don’t carry over. Your free trial video doesn’t count toward your monthly videos.
          </p>
          <p>
            We never charge you extra for going over your videos. You can upgrade instead. Prices don’t include
            any sales tax that applies where you live. If we change the price of your plan, we’ll email you at least
            30 days before it applies, and you can cancel before then.
          </p>
        </Part>

        <Part title="Changing, cancelling and refunds">
          <p>
            You can switch plans, update your card or cancel anytime from your dashboard under “manage billing”.
            When you cancel, your membership stays active until the end of the period you paid for, then stops.
            You won’t be charged again.
          </p>
          <p>
            Payments aren’t refunded, including for part of a month or year or for videos you didn’t use, except
            where the law requires it. If something went wrong with a charge, email <Email /> and we’ll look into
            it.
          </p>
        </Part>

        <Part title="Your content">
          <p>
            “Your content” means the clips, inspiration videos, audio, text and requests you upload or type, and the
            videos and captions we make for you. You keep all the rights you have in it. We don’t claim ownership
            of your clips or your finished videos.
          </p>
          <p>
            You give us permission to store, copy, process, edit and show your content to you, and to send it to the
            services that help us run viralowner (listed in our <PageLink href="/privacy">privacy policy</PageLink>),
            only to provide and improve viralowner for you. Each day, viralowner also learns general lessons from
            change requests, notes and feedback (without your personal details) so future videos come out better
            for everyone. We won’t post your videos publicly or use them in our marketing without your permission.
          </p>
          <p>
            When you upload anything, you confirm you own it or have permission to use it, including permission
            from the people who appear or can be heard in your clips. You’re responsible for your content and for
            how you use the videos we make.
          </p>
        </Part>

        <Part title="Inspiration videos">
          <p>
            An inspiration video is only a style reference: we study its structure, pacing and text to edit your
            own clips the same way. Don’t repost its footage, and don’t present someone else’s video as your own.
            Copying a format is common; copying someone’s footage, voice or exact words can break their rights.
          </p>
        </Part>

        <Part title="Audio">
          <p>
            viralowner does not own, license or provide any of the audio used in your videos. That includes any
            audio file you upload, the sound from an inspiration video you choose to use, and your clips’ own
            sound. We only edit it into your video the way you ask.
          </p>
          <p>
            Audio such as songs, trending sounds and other people’s voices usually belongs to someone else. By
            uploading or choosing audio, you confirm you own it or have permission to use it, and you take full
            responsibility for how you use it. viralowner isn’t responsible for any copyright claim, muting,
            takedown or other action taken against your videos or accounts because of their audio.
          </p>
          <p>
            The safest way to use a trending sound is to make your video with no music and add the sound inside
            TikTok or Instagram when you post, where it’s licensed for use.
          </p>
        </Part>

        <Part title="Things you can’t do">
          <p>Don’t use viralowner to make, upload or share anything that:</p>
          <List
            items={[
              "you don’t have the rights to, or that breaks someone’s copyright, trademark, privacy or publicity rights",
              "shows or impersonates a real person in a misleading way, or uses someone’s face or voice without their permission",
              "is sexual, or shows or sexualizes anyone under 18 in any way",
              "is hateful, harassing, violent or threatening, or promotes self-harm",
              "is illegal, fraudulent or deceptive, including fake reviews, false claims about products, or ads that break the law",
              "includes someone’s private information without their permission",
            ]}
          />
          <p>
            Also don’t: share your account, resell viralowner, get around plan limits or the free trial limit, try
            to break, overload or reverse engineer viralowner, or use bots to access it.
          </p>
        </Part>

        <Part title="Social platforms">
          <p>
            viralowner isn’t affiliated with, endorsed by or sponsored by TikTok, Instagram, Meta, YouTube or any
            other platform. Their names are trademarks of their owners and are used only to describe where you can
            post. When you post, follow each platform’s rules, including any rules about labelling edited or
            AI-made content and branded or paid content.
          </p>
        </Part>

        <Part title="Copyright complaints">
          <p>
            We respect copyright. If you believe content on viralowner infringes your copyright, send our copyright
            agent a notice with: your contact details and signature; the work you believe was infringed; the
            content and where it is on viralowner; a statement that you believe in good faith the use isn’t
            authorized; and a statement, under penalty of perjury, that your notice is accurate and you’re the
            owner or allowed to act for the owner.
          </p>
          <p>
            Copyright agent: {LEGAL.copyrightAgent}, {LEGAL.company}, {LEGAL.address}, <Email />, {LEGAL.copyrightAgentPhone}. We remove content
            that infringes and close the accounts of people who infringe repeatedly. If your content was removed by
            mistake, you can send us a counter notice.
          </p>
        </Part>

        <Part title="Ending your account">
          <p>
            You can stop using viralowner anytime, and delete your videos from your dashboard. To delete your
            account, email <Email />. We may suspend or close your account, without a refund, if you break these
            terms, if we must by law, or to protect viralowner or other people. Sections that should last after
            your account ends (like your content, disclaimers, limits on liability and disputes) still apply.
          </p>
        </Part>

        <Part title="Disclaimers">
          <p className="uppercase">
            viralowner is provided “as is” and “as available”. To the fullest extent the law allows, we disclaim all
            warranties, express or implied, including merchantability, fitness for a particular purpose and
            non-infringement, and we don’t promise the service or its results will be accurate, uninterrupted or
            error free.
          </p>
        </Part>

        <Part title="Limits on our liability">
          <p className="uppercase">
            To the fullest extent the law allows, we aren’t liable for any indirect, incidental, special,
            consequential or punitive damages, or for lost profits, revenue, followers, data or goodwill, or for
            anything a platform does to your videos or accounts. Our total liability for any claim about viralowner
            is limited to the greater of what you paid us in the 12 months before the claim or $100.
          </p>
          <p>Some places don’t allow these limits, so they may not all apply to you.</p>
        </Part>

        <Part title="Your responsibility to us">
          <p>
            If someone makes a claim against us because of your content, how you used the videos we made, or your
            breaking these terms or the law, you’ll cover our reasonable costs of it, including legal fees.
          </p>
        </Part>

        <Part title="Disputes">
          <p>
            Please email <Email /> first: most problems can be fixed quickly. If we can’t resolve it within 60 days,
            these terms are governed by the laws of {LEGAL.state} and the United States, without regard to conflict
            of law rules.
          </p>
          <p>
            <strong className="text-foreground">Arbitration.</strong> You and we agree to resolve any dispute through
            final, binding individual arbitration administered by the American Arbitration Association under its
            Consumer Arbitration Rules, instead of in court, except that either of us can bring a claim in small
            claims court or ask a court to stop infringement of intellectual property. You and we each waive the
            right to a jury trial and to take part in a class action or class arbitration. You can opt out of this
            arbitration agreement by emailing <Email /> within 30 days of first accepting these terms.
          </p>
        </Part>

        <Part title="Changes to these terms">
          <p>
            We may update these terms. If a change is important, we’ll tell you by email or on viralowner before it
            applies. If you keep using viralowner after that, you accept the new terms. If you don’t, you can
            cancel.
          </p>
        </Part>

        <Part title="Everything else">
          <p>
            These terms and the privacy policy are the whole agreement between you and us about viralowner. If any
            part is found unenforceable, the rest still applies. Not enforcing a part isn’t a waiver of it. You
            can’t transfer these terms without our permission; we can transfer them if viralowner is sold or merged.
          </p>
        </Part>

        <p>
          Questions? Email <Email /> or write to {LEGAL.company}, {LEGAL.address}.
        </p>
      </div>
    </AuthShell>
  );
}
