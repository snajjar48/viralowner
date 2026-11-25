"use client";

import { useState } from "react";
import { buttonClass } from "./form";

/**
 * In the iPhone app, plans are bought on the website (App Store rules): this opens the same page in
 * Safari. The app sends any visit to /plans or /signup to Safari, so a full page load is enough.
 */
export function ContinueInSafari({ path, what }: { path: "/plans" | "/signup"; what: "plan" | "account" }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <p className="text-muted text-pretty">
        {what === "plan"
          ? "plans are bought on our website. tap below to choose one in Safari, then come back here: your plan shows up right away."
          : "accounts are made on our website. tap below to sign up in Safari, then come back here and log in."}
      </p>
      <button
        type="button"
        onClick={() => {
          setOpened(true);
          window.location.assign(`${window.location.origin}${path}?from=app`);
        }}
        className={`${buttonClass} w-full max-w-sm`}
      >
        {what === "plan" ? "choose a plan in Safari" : "sign up in Safari"}
      </button>
      {opened && <p className="text-sm text-muted">opened in Safari. done? come back to the app.</p>}
    </div>
  );
}
