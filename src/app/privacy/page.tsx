import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { AuthShell } from "@/components/auth-shell";
import { Effective, Email, List, PageLink, Part } from "@/components/legal";
import { LEGAL } from "@/content/legal";

export const metadata: Metadata = pageMetadata({
  title: "privacy policy",
  description: "what viralowner collects, why, who helps us run it, how long we keep it and your choices.",
  path: "/privacy",
  index: false,
});

// Written in plain words. Keep it in step with the code: if a new service starts handling
// people's data (analytics, ads, another AI provider), add it here first. Have a lawyer review it.
export default function PrivacyPage() {
  return (
    <AuthShell title="Privacy policy" wide>
      <div className="flex flex-col gap-8 text-sm text-muted text-pretty">
        <Effective />

        <Part title="The short version">
          <List
            items={[
              "We collect what we need to make your videos and run your account.",
              "We don’t sell your information or share it for advertising.",
              "Your clips and videos are only used to make your videos. We don’t post them anywhere.",
              "You can delete your videos anytime, and delete your whole account yourself from your profile.",
            ]}
          />
          <p>
            This policy covers viralowner.com, run by {LEGAL.company} (“we”, “us”). It’s part of our{" "}
            <PageLink href="/terms">terms</PageLink>.
          </p>
        </Part>

        <Part title="What we collect">
          <List
            items={[
              <>
                <strong className="text-foreground">Account details:</strong> your name, email address and password
                (stored scrambled, never readable), your plan and when you accepted the terms.
              </>,
              <>
                <strong className="text-foreground">Payment details:</strong> your card is entered into and stored by
                our payment provider, Stripe. We never see or store your full card number; we only see the card
                type, its last 4 digits and expiry date, and your payment history.
              </>,
              <>
                <strong className="text-foreground">What you upload and type:</strong> your clips, inspiration
                videos, audio, change requests, notes, settings and feedback, plus the videos and captions we make.
                Clips can show people’s faces and include their voices.
              </>,
              <>
                <strong className="text-foreground">Waitlist and tester sign-ups:</strong> your email address and
                where you signed up from.
              </>,
              <>
                <strong className="text-foreground">Technical details:</strong> your IP address, browser and device
                type, and logs of errors and requests, used to keep viralowner secure and working (for example, to
                stop spam sign-ups).
              </>,
            ]}
          />
        </Part>

        <Part title="How we use it">
          <List
            items={[
              "to make, change and deliver your videos and captions",
              "to run your account, your free trial and your membership, and to take payments",
              "to email you about your account, like confirming your email, resetting your password and telling you when a video is ready, and about launch if you joined the waitlist",
              "to improve viralowner (see “how viralowner learns” below)",
              "to prevent fraud and abuse, including more than one free trial per person, and to keep viralowner secure",
              "to follow the law and enforce our terms",
            ]}
          />
          <p>
            If you’re in the European Union or United Kingdom, we use your information to provide the service you
            asked for (our contract with you), for our legitimate interests in improving and securing viralowner,
            to follow the law, and with your consent where we ask for it.
          </p>
        </Part>

        <Part title="AI and your videos">
          <p>
            To edit your video, we send frames and audio from your clips and inspiration video, your requests and
            the words spoken in your clips to our AI model provider, Anthropic. It processes them only to return the
            edit to us. It doesn’t keep or store them for its own use: it never trains its models on them, and it
            deletes them automatically. The iPhone app asks for your OK to this before you start.
          </p>
          <p>
            To frame shots and keep text off people, our software detects where faces are in a frame. It doesn’t
            recognize or identify anyone, and we don’t create or keep face or voice prints.
          </p>
        </Part>

        <Part title="How viralowner learns">
          <p>
            Each day, viralowner turns recent change requests, notes and feedback from everyone into general editing
            lessons (for example, “keep the text shorter on food videos”), so future videos come out right the
            first time. These lessons don’t include names, emails or other personal details, and they don’t contain
            your clips or videos.
          </p>
        </Part>

        <Part title="Who helps us run viralowner">
          <p>We share information only with the services that run viralowner for us, only for that purpose:</p>
          <List
            items={[
              "Stripe: payments and saved cards",
              "Supabase: accounts, sign-in and our database",
              "Vercel: hosting the website",
              "Cloudflare: storing your uploads and videos",
              "Modal: the servers that edit your videos",
              "Anthropic: the AI that understands your clips and requests and plans the edit",
              "Resend: sending emails",
              "Expo: sending notifications to the iPhone app (when you allow them)",
            ]}
          />
          <p>
            We may also share information if the law requires it, to protect people’s safety or our rights, or as
            part of a merger or sale of viralowner (and we’d tell you). We don’t sell your personal information and
            don’t share it for targeted advertising.
          </p>
        </Part>

        <Part title="Cookies">
          <p>
            We only use cookies that viralowner needs to work: to keep you signed in and to keep the site secure.
            Stripe sets its own cookies on payment forms to prevent fraud. We don’t use advertising or tracking
            cookies.
          </p>
        </Part>

        <Part title="How long we keep it">
          <List
            items={[
              "Your videos, clips and projects: until you delete them or your account. Drafts nobody opened in 30 days are deleted automatically.",
              "Your account: until you delete it. Deleting it from your profile removes it, with your uploads and videos, right away (backups and logs clear within 30 days). If you ask us by email instead, we delete it within 30 days.",
              "Payment records: as long as tax and accounting laws require, even after your account is deleted.",
              "Waitlist emails: until launch is over or you ask us to remove yours.",
            ]}
          />
        </Part>

        <Part title="Your choices and rights">
          <p>
            You can see and change your account details on your profile, delete any video from your dashboard, and delete your account at the bottom of your profile.
            You can also email <Email /> to ask for a copy of your information, to correct it, to delete your
            account and information, or to stop any emails that aren’t about your account. We’ll answer within 30
            days and won’t treat you differently for asking.
          </p>
          <p>
            Depending on where you live (for example California, other US states, the EU or the UK), you may have
            more rights, like objecting to or limiting how we use your information, or complaining to your local
            data protection authority. We’ll honor those rights where they apply. We may need to confirm it’s you
            before acting on a request.
          </p>
        </Part>

        <Part title="Keeping it safe">
          <p>
            We protect your information with encryption in transit, access controls and secure providers. No
            service is perfectly secure, so please use a strong password and tell us at <Email /> if you notice
            anything wrong.
          </p>
        </Part>

        <Part title="Children">
          <p>
            viralowner is for adults 18 and over. We don’t knowingly collect information from children under 13.
            If you believe a child gave us their information, email <Email /> and we’ll delete it.
          </p>
        </Part>

        <Part title="Where your information is">
          <p>
            We’re based in the United States and our providers store information in the US and other countries. If
            you use viralowner from outside the US, your information is transferred to and handled in the US.
          </p>
        </Part>

        <Part title="Changes">
          <p>
            We’ll update this policy when what we do changes, and tell you by email or on viralowner before an
            important change applies. The date at the top shows the latest version.
          </p>
        </Part>

        <p>
          Questions or requests? Email <Email /> or write to {LEGAL.company}, {LEGAL.address}.
        </p>
      </div>
    </AuthShell>
  );
}
