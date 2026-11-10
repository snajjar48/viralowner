import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthLayout, EditPreview, Eyebrow, GradientText } from "@/components/auth-layout";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "viralowner — log in",
  robots: { index: false, follow: false },
};

function Pitch() {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-5">
        <Eyebrow>welcome back</Eyebrow>
        <h2 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl">
          your next <GradientText>viral video</GradientText> is waiting.
        </h2>
        <p className="max-w-lg text-lg text-muted text-pretty">
          Drop in your raw clips and we’ll turn them into edits with your spin on them. You skip
          the editing and keep the views.
        </p>
      </div>
      <div className="hidden sm:block">
        <EditPreview />
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout
      aside={<Pitch />}
      title="Log in"
      subtitle="Good to see you again."
      centered
    >
      {/* The form reads ?next= and ?error= from the URL, so it renders per request. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
