import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AuthLayout, Eyebrow, GradientText } from "@/components/auth-layout";
import { inviteEmail } from "@/lib/tester-invite";
import { isTester } from "@/lib/testers";
import { TesterSignupForm } from "./tester-signup-form";

export const metadata: Metadata = {
  title: "join the beta",
  robots: { index: false, follow: false },
};

function Pitch() {
  return (
    <div className="flex flex-col gap-5">
      <Eyebrow>beta tester invite</Eyebrow>
      <h2 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
        you’re in. <GradientText>everything’s free.</GradientText>
      </h2>
      <p className="max-w-lg text-lg text-muted text-pretty">
        Full access to remakes and start from scratch, with no video limits and no card. Make as many videos as you
        like and tell us what you think.
      </p>
    </div>
  );
}

type Params = Promise<{ e?: string; t?: string }>;

export default function JoinPage({ searchParams }: { searchParams: Params }) {
  return (
    <Suspense fallback={null}>
      <Join searchParams={searchParams} />
    </Suspense>
  );
}

async function Join({ searchParams }: { searchParams: Params }) {
  const { e, t } = await searchParams;
  const email = inviteEmail(e, t);
  const valid = !!email && (await isTester(email));
  return (
    <AuthLayout
      aside={<Pitch />}
      centered
      title={valid ? "Create your beta account" : "This invite isn’t valid"}
      subtitle={
        valid ? (
          <>
            No card needed. Already have an account?{" "}
            <Link href="/login" className="whitespace-nowrap text-foreground underline underline-offset-4">
              Log in
            </Link>
          </>
        ) : (
          "The link may be incomplete or it was turned off. Ask the person who invited you for a new one."
        )
      }
    >
      {valid && email ? <TesterSignupForm email={email} token={t as string} /> : null}
    </AuthLayout>
  );
}
