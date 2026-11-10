import Image from "next/image";
import { WaitlistForm } from "./waitlist-form";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col items-center px-6">
      <header className="pt-10 sm:pt-14">
        <Image
          src="/logo.svg"
          alt="viralowner"
          width={1458}
          height={418}
          preload
          className="h-10 w-auto sm:h-12"
        />
      </header>

      <main className="flex w-full max-w-xl flex-1 flex-col items-center justify-center py-24 text-center">
        <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight text-balance sm:text-6xl">
          skip the editing, keep the views.
        </h1>
        <p className="mt-6 text-lg text-muted text-balance sm:text-xl">
          upload your raw clips &amp; we’ll handle the edit.
        </p>
        <div className="mt-12 w-full max-w-md">
          <WaitlistForm />
        </div>
      </main>

      <footer className="pb-10 sm:pb-14">
        <a
          href="mailto:hello@viralowner.com"
          className="text-sm text-muted transition hover:text-foreground"
        >
          hello@viralowner.com
        </a>
      </footer>
    </div>
  );
}
