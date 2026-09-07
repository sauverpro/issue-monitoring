import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { EmptyState, PageHeader, Panel } from "@/org/components/ui";

type Behavior = {
  screens: { screen: string; views: number; users: number }[];
  journeys: { path: string[]; count: number; pct: number }[];
  sessionsSampled: number;
};

export function BehaviorPage() {
  const { projectId } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<Behavior | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<Behavior>(`/console/projects/${projectId}/behavior?${range.query}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, range.query]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div>
      <PageHeader
        eyebrow="Analytics"
        title="User Behavior"
        description="Most visited screens and common journeys."
        actions={<TimeRangePicker />}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Most visited screens
          </div>
          <table className="w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-5 py-2">Screen</th>
                <th className="px-5 py-2">Views</th>
                <th className="px-5 py-2">Users</th>
              </tr>
            </thead>
            <tbody>
              {data.screens.map((s) => (
                <tr key={s.screen} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-5 py-3 font-mono text-xs">{s.screen}</td>
                  <td className="px-5 py-3 tabular-nums">{s.views.toLocaleString()}</td>
                  <td className="px-5 py-3 tabular-nums">{s.users.toLocaleString()}</td>
                </tr>
              ))}
              {data.screens.length === 0 && (
                <tr>
                  <td colSpan={3}>
                    <EmptyState title="No screen views" body="Send navigation events to populate this list." />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Panel>
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Most common journeys
          </div>
          <div className="space-y-4 p-5">
            {data.journeys.length === 0 ? (
              <EmptyState title="No journeys" body="Navigation sequences will rank here." />
            ) : (
              data.journeys.map((j) => (
                <div key={j.path.join("→")} className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                  {j.path.map((step, i) => (
                    <div key={`${step}-${i}`} className="text-sm">
                      {i > 0 && <p className="ml-2 text-zinc-400">↓</p>}
                      <p className="font-mono text-xs">{step}</p>
                    </div>
                  ))}
                  <p className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {(j.pct * 100).toFixed(1)}% of sampled sessions ({data.sessionsSampled.toLocaleString()})
                  </p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}
