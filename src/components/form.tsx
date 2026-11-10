import type { ReactNode } from "react";

export const inputClass =
  "h-12 w-full rounded-xl border border-white/15 bg-white/5 px-4 text-base text-foreground placeholder:text-muted/70 outline-none transition focus:border-white/40 focus:bg-white/[0.08] read-only:opacity-60";

export const buttonClass =
  "h-12 w-full cursor-pointer rounded-full bg-linear-to-r from-violet to-coral px-6 text-base font-medium text-white shadow-[0_10px_30px_-8px_rgba(123,47,247,0.7)] transition hover:brightness-110 hover:shadow-[0_14px_40px_-8px_rgba(255,61,110,0.7)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-coral disabled:cursor-wait disabled:opacity-70";

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

export function FormError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="min-h-5 text-center text-sm text-coral">
      {message}
    </p>
  );
}
