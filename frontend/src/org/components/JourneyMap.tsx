import { clsx } from "clsx";
import type { JourneyMapNode } from "@/org/types";
import { formatClock } from "@/org/lib/journey";

export function JourneyMap({ nodes }: { nodes: JourneyMapNode[] }) {
  if (nodes.length === 0) return null;
  return (
    <div>
      <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        User Journey
      </h3>
      <ol className="space-y-0">
        {nodes.map((n, i) => (
          <li key={`${n.screen}-${n.time}-${i}`} className="flex gap-3">
            <div className="flex w-4 flex-col items-center">
              <span
                className={clsx(
                  "mt-1 h-2.5 w-2.5 rounded-full",
                  n.failed ? "bg-red-500" : "bg-indigo-500"
                )}
              />
              {i < nodes.length - 1 && (
                <span className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
              )}
            </div>
            <div className={clsx("mb-4 min-w-0 pb-1", n.failed && "text-red-700 dark:text-red-400")}>
              <p className="font-medium">{n.failed ? `${n.screen}` : n.screen}</p>
              <p className="text-xs text-zinc-500">
                {formatClock(n.time)}
                {n.apiTotal > 0 && (
                  <>
                    {" · "}
                    {n.apiTotal} API call{n.apiTotal === 1 ? "" : "s"}
                    {" · "}
                    <span className="text-emerald-600 dark:text-emerald-400">✓ {n.apiOk}</span>
                    {n.apiFail > 0 && (
                      <span className="text-red-600 dark:text-red-400"> · ✕ {n.apiFail}</span>
                    )}
                  </>
                )}
              </p>
              {n.failed && (
                <p className="mt-1 text-xs font-semibold uppercase tracking-wide">API error</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
