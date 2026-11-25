"use client";

import { useEffect } from "react";
import { syncAppPush } from "@/lib/native-app";

/** In the iPhone app: registers for "your video is ready" notifications (`ask`: may show the prompt). */
export function AppPush({ ask = false }: { ask?: boolean }) {
  useEffect(() => syncAppPush(ask), [ask]);
  return null;
}
