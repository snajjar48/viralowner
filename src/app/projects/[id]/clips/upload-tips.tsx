"use client";

import { useSyncExternalStore } from "react";
import { inApp } from "@/lib/native-app";

type Device = "app" | "iphone" | "android" | "computer";

function detect(): Device {
  if (inApp()) return "app";
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  // iPads say they're Macs: a Mac with a touch screen is an iPad.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "iphone";
  return "computer";
}
const noSubscribe = () => () => {};

/** "tips for faster uploads": a few that fit this device (the app, iPhone, Android or a computer). */
export function UploadTips() {
  const device = useSyncExternalStore(noSubscribe, detect, () => "computer" as Device);

  const tips: string[] = [
    "you don’t have to wait. keep going while your clips upload: we finish them in the background and start your video when they’re in.",
    device === "computer"
      ? "a good connection is fastest: wifi close to the router, or a cable."
      : "wifi is fastest. big clips upload much quicker on wifi than on cell data.",
    device === "computer"
      ? "trim before you upload. cut long clips down to the good part first: smaller clips upload faster."
      : "trim before you upload. cut long clips down to the good part in your photos app first: smaller clips upload faster.",
  ];
  if (device === "app" || device === "iphone") {
    tips.push(
      "clips kept in icloud download first. if your phone stores videos in icloud, it grabs them before uploading, which takes longer. open them once in photos to have them ready.",
    );
  }
  if (device === "android") {
    tips.push(
      "clips only in google photos download first. if a video was backed up and removed from your phone, it downloads before uploading, which takes longer. save it to your phone first (in google photos: ⋮ › download).",
      "keep chrome open and your screen on until your clips are in. android can pause uploads in apps you’re not looking at.",
    );
  }
  if (device === "app") {
    tips.push("keep the app open while clips upload. they keep going for a little while if you switch apps, but staying here is quickest.");
  } else {
    tips.push("keep this tab open until your clips are in. closing it stops the upload.");
  }

  return (
    <details className="group rounded-xl border border-white/10 px-3 py-2 text-xs text-muted">
      <summary className="cursor-pointer list-none text-center focus-visible:outline-2 focus-visible:outline-coral [&::-webkit-details-marker]:hidden">
        tips for faster uploads <span aria-hidden="true" className="inline-block transition group-open:rotate-180">▾</span>
      </summary>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-pretty">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </details>
  );
}
