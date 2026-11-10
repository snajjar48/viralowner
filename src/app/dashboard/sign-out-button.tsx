"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/unlock", { method: "DELETE" });
    router.replace("/");
    router.refresh(); // drop any cached private pages from the client router
  }

  return (
    <button
      type="button"
      onClick={signOut}
      className="cursor-pointer text-sm text-muted underline-offset-4 transition hover:text-foreground hover:underline"
    >
      Sign out
    </button>
  );
}
