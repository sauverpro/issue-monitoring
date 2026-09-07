import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta } from "@/org/lib/metrics";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { LineChart } from "@/org/components/charts";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";

type Performance = {
  kpis: {
    avgLatencyMs: number;
    avgDelta: number | null;
    p95Ms: number;
    p95Delta: number | null;
    p99Ms: number;
    p99Delta: number | null;
    slowApis: number;
    slowDelta: number | null;
  };
  latency: { label: string; avgMs: number }[];
  latencyUnit: "hour" | "day";
  endpoints: {
    method: string;
    path: string;
    total: number;
    avgLatencyMs: number;
    p95Ms: number;
    p99Ms: number;
  }[];
};

export function PerformancePage() {
  const { projectId } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setData(await apiFetch<Performance>(`/console/projects/${projectId}/performance?${range.query}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [projectId, range.query]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="Performance"
        description="API latency across your application."
        actions={<TimeRangePicker />}
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Avg latency"
          value={`${data.kpis.avgLatencyMs}ms`}
          hint={<Delta value={data.kpis.avgDelta} invert />}
        />
        <StatCard
          label="P95"
          value={`${(data.kpis.p95Ms / 1000).toFixed(2)}s`}
          hint={<Delta value={data.kpis.p95Delta} invert />}
        />
        <StatCard
          label="P99"
          value={`${(data.kpis.p99Ms / 1000).toFixed(2)}s`}
          hint={<Delta value={data.kpis.p99Delta} invert />}
        />
        <StatCard
          label="Slow APIs"
          value={data.kpis.slowApis}
          hint={<Delta value={data.kpis.slowDelta} invert />}
        />
      </div>
      <Panel className="mb-6">
        <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
          API latency
        </div>
        <div className="p-4">
          <LineChart
            labels={data.latency.map((p) =>
              data.latencyUnit === "hour" ? `${p.label}:00` : p.label.slice(5)
            )}
            series={[{ name: "Avg ms", color: "#f59e0b", values: data.latency.map((p) => p.avgMs) }]}
          />
        </div>
      </Panel>
      <Panel>
        <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
          Slowest endpoints
        </div>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-5 py-2">Endpoint</th>
              <th className="px-5 py-2">Avg</th>
              <th className="px-5 py-2">P95</th>
              <th className="px-5 py-2">Requests</th>
            </tr>
          </thead>
          <tbody>
            {data.endpoints.map((r, i) => (
              <tr key={`${r.method}-${r.path}-${i}`} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-5 py-3 font-mono text-xs">
                  {r.method} {r.path}
                </td>
                <td className="px-5 py-3 tabular-nums">{r.avgLatencyMs}ms</td>
                <td className="px-5 py-3 tabular-nums">{(r.p95Ms / 1000).toFixed(2)}s</td>
                <td className="px-5 py-3 tabular-nums">{r.total.toLocaleString()}</td>
              </tr>
            ))}
            {data.endpoints.length === 0 && (
              <tr>
                <td colSpan={4}>
                  <EmptyState title="No latency data" body="API calls with latency_ms will rank here." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
