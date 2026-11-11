/** A labeled progress bar (0–100). */
export function ProgressBar({ value, label, showValue = true }: { value: number; label: string; showValue?: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{label}</span>
        {showValue && <span className="tabular-nums text-foreground">{v}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className="h-2 w-full overflow-hidden rounded-full bg-white/10"
      >
        <div
          className="h-full rounded-full bg-linear-to-r from-violet to-coral transition-[width] duration-300 ease-out"
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}
