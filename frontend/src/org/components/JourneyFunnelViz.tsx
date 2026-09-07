import type { FunnelStep } from "@/org/types";

export function JourneyFunnelViz({ steps }: { steps: FunnelStep[] }) {
  if (steps.length === 0) return null;
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
      <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        Journey visualization
      </p>
      <div className="flex flex-col items-center gap-1">
        {steps.map((s, i) => (
          <div key={`${s.screen}-${i}`} className="flex w-full max-w-md flex-col items-center">
            <div className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-center dark:border-zinc-700 dark:bg-zinc-800/50">
              <p className="font-mono text-xs font-semibold uppercase tracking-wide text-zinc-800 dark:text-zinc-100">
                {s.screen.replace(/^\//, "").replace(/\//g, " / ") || s.screen}
              </p>
              <p className="text-sm tabular-nums text-zinc-500">{s.users.toLocaleString()} users</p>
            </div>
            {i < steps.length - 1 && (
              <div className="py-1 text-center text-xs text-zinc-400">
                │ {(s.conversion * 100).toFixed(1)}%
                <br />▼
              </div>
            )}
          </div>
        ))}
        <p className="mt-2 text-lg text-zinc-300">✕</p>
      </div>
    </div>
  );
}

export function InlineFunnel({ steps }: { steps: FunnelStep[] }) {
  if (steps.length < 2) return null;
  return (
    <div className="space-y-2">
      {steps.slice(0, 5).map((s, i) => (
        <div key={s.screen} className="flex items-center gap-2 text-sm">
          <span className="font-mono text-xs text-zinc-600 dark:text-zinc-300">{s.screen}</span>
          {i < steps.length - 1 && (
            <span className="text-xs text-zinc-400">
              → {(steps[i + 1]!.conversion * 100).toFixed(1)}%
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
