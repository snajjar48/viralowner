"use client";

import { useRouter } from "next/navigation";

export function AdminSignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/admin/logout", { method: "POST" }).catch(() => null);
        router.replace("/dashboard");
      }}
      className="cursor-pointer rounded-full px-3 py-1.5 text-muted hover:bg-white/5 hover:text-coral"
    >
      lock
    </button>
  );
}
