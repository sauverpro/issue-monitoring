import { clsx } from "clsx";

export type CallOutcome = "SUCCESS" | "FAILURE" | "OTHER";

export function OutcomeBadge({
  outcome,
  className,
}: {
  outcome: CallOutcome | null | undefined;
  className?: string;
}) {
  if (!outcome) {
    return <span className={clsx("text-zinc-600", className)}>—</span>;
  }
  const styles: Record<CallOutcome, string> = {
    SUCCESS:
      "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
    FAILURE: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-300",
    OTHER: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-200",
  };
  return (
    <span
      className={clsx(
        "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        styles[outcome],
        className
      )}
    >
      {outcome === "OTHER" ? "Other (no HTTP)" : outcome}
    </span>
  );
}
