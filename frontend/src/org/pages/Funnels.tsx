import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import type { FunnelStep } from "@/org/types";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { JourneyFunnelViz } from "@/org/components/JourneyFunnelViz";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";

type FunnelReport = {
  steps: FunnelStep[];
  conversion: number;
  dropoff: {
    from: string;
    to: string;
    fromCount: number;
    toCount: number;
    rate: number;
    causes: string[];
  } | null;
};

export function FunnelsPage() {
  const { projectId } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<FunnelReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<FunnelReport>(`/console/projects/${projectId}/reports/funnels?${range.query}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, range.query]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const max = Math.max(1, ...data.steps.map((s) => s.users));

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="Funnels"
        description="Conversion through your primary screen flow."
        actions={<TimeRangePicker />}
      />
      <div className="mb-6 max-w-xs">
        <StatCard
          label="Overall conversion"
          value={`${(data.conversion * 100).toFixed(1)}%`}
          hint={range.label}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Screen funnel
          </div>
          <div className="space-y-3 p-5">
            {data.steps.length === 0 ? (
              <EmptyState title="No funnel" body="Send navigation with from_screen to build steps." />
            ) : (
              data.steps.map((s, i) => (
                <div key={s.screen}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-mono text-xs">
                      {s.users.toLocaleString()} · {s.screen}
                    </span>
                    {i > 0 && (
                      <span className="text-xs text-zinc-500">{(s.conversion * 100).toFixed(0)}% from prior</span>
                    )}
                  </div>
                  <div className="h-8 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <div
                      className="flex h-full items-center rounded-lg bg-indigo-500/80 px-2 text-xs text-white"
                      style={{ width: `${Math.max(12, (s.users / max) * 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Panel>
        <div className="space-y-6">
          <JourneyFunnelViz steps={data.steps} />
          {data.dropoff && (
            <Panel>
              <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
                Largest drop-off
              </div>
              <div className="space-y-3 p-5 text-sm">
                <p className="font-medium">
                  {data.dropoff.from} → {data.dropoff.to}
                </p>
                <p className="text-zinc-500">
                  {data.dropoff.fromCount.toLocaleString()} → {data.dropoff.toCount.toLocaleString()} (
                  {(data.dropoff.rate * 100).toFixed(0)}% lost)
                </p>
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Possible causes</p>
                <ul className="list-inside list-disc text-zinc-600 dark:text-zinc-300">
                  {data.dropoff.causes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
