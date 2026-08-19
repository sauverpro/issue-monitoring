import { useMemo, useState } from "react";
import { clsx } from "clsx";
import type { SessionAction } from "@/types/session";
import {
  actionOutcome,
  formatActionLabel,
  formatTime,
} from "@/lib/sessionUtils";

const PAGE_SIZE = 50;

const outcomeStyles = {
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failure: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  warning: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200",
};

export function ActionTimeline({ actions }: { actions: SessionAction[] }) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  const slice = useMemo(() => actions.slice(0, visible), [actions, visible]);

  if (actions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-zinc-600 dark:text-zinc-500">No actions recorded.</p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2" role="list">
        {slice.map((action) => {
          const outcome = actionOutcome(action);
          const label = formatActionLabel(action);
          return (
            <li
              key={action.id}
              className={clsx(
                "flex flex-col gap-1 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
                outcomeStyles[outcome]
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">
                  <span className="text-zinc-600 dark:text-zinc-500">[{action.actionIndex}]</span>{" "}
                  {label}
                </p>
                {action.failureReason && (
                  <p className="mt-1 text-xs opacity-90">{action.failureReason}</p>
                )}
                {action.service && (
                  <p className="mt-0.5 text-xs opacity-70">{action.service}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs">
                <span className="font-semibold uppercase tracking-wide">
                  {outcome === "success"
                    ? "Success"
                    : outcome === "failure"
                      ? action.httpStatus ?? "Failed"
                      : "Warning"}
                </span>
                <span className="tabular-nums text-zinc-700 dark:text-zinc-400">
                  {formatTime(action.timestamp)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {visible < actions.length && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + PAGE_SIZE)}
          className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 py-2 text-sm text-zinc-700 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          Load more ({actions.length - visible} remaining)
        </button>
      )}
    </div>
  );
}
