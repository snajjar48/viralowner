import type { ReactNode } from "react";
import { BackgroundGlow, Logo } from "./auth-layout";

/** Simple centered page with the logo (also /terms and /privacy, with `wide`). */
export function AuthShell({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="relative isolate flex min-h-dvh flex-col items-center px-6 py-12 sm:py-16">
      <BackgroundGlow />
      <Logo className="h-10 w-auto" />
      <main className={`mt-12 w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>
        <h1 className="text-center text-3xl font-semibold tracking-tight">{title}</h1>
        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
