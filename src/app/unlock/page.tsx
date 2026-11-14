import type { Metadata } from "next";
import Image from "next/image";
import { UnlockForm } from "./unlock-form";

export const metadata: Metadata = {
  title: "private",
  robots: { index: false, follow: false },
};

export default function UnlockPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6">
      <Image src="/logo.svg" alt="viralowner" width={1458} height={418} className="h-10 w-auto" />
      <div className="mt-12 w-full max-w-sm">
        <UnlockForm />
      </div>
    </div>
  );
}
