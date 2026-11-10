import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/** Centered layout with the logo, shared by the login and sign-up pages. */
export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-6 py-12 sm:py-16">
      <Link href="/" aria-label="viralowner home">
        <Image src="/logo.svg" alt="viralowner" width={1458} height={418} className="h-10 w-auto" />
      </Link>
      <main className="mt-12 w-full max-w-md">
        <h1 className="text-center text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
