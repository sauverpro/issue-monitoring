import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { apiFetch } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import type { SessionAnalytics } from "@/types/session";

export function SessionAnalyticsPage() {
  const [data, setData] = useState<SessionAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<SessionAnalytics>(
          `/api/sessions/analytics?days=${days}`
        );
        if (!cancelled) {
          setData(res);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Session analytics</h1>
          <p className="mt-1 text-sm text-zinc-400">
            Volume, error rates, and failing endpoints from ingested Sentry data.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Window
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value={1}>1 day</option>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
        </label>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      {loading || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs text-zinc-500">Failed API calls</p>
              <p className="mt-1 text-2xl font-semibold text-red-300">
                {data.failedApiCalls}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs text-zinc-500">Active users</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">
                {data.activeUsers}
              </p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="text-xs text-zinc-500">Avg actions / session</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">
                {data.averageActionsPerSession.toFixed(1)}
              </p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard title="Session volume">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data.sessionVolume}>
                  <CartesianGrid stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Error rate by service">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={data.errorRateByService.map((s) => ({
                    ...s,
                    errorPct: s.errorRate * 100,
                  }))}
                >
                  <CartesianGrid stroke="#27272a" />
                  <XAxis dataKey="service" tick={{ fill: "#71717a", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #3f3f46",
                    }}
                  />
                  <Bar dataKey="errorPct" fill="#f87171" name="Error %" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <ChartCard title="Top failing endpoints">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase text-zinc-500">
                  <tr>
                    <th className="pb-2">Endpoint</th>
                    <th className="pb-2 text-right">Failures</th>
                    <th className="pb-2 text-right">Users</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800">
                  {data.topFailingEndpoints.map((ep) => (
                    <tr key={ep.endpoint}>
                      <td className="max-w-md truncate py-2 font-mono text-xs text-emerald-400/90">
                        {ep.endpoint}
                      </td>
                      <td className="py-2 text-right text-red-300">{ep.failures}</td>
                      <td className="py-2 text-right text-zinc-400">
                        {ep.uniqueUsers}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </>
      )}
    </div>
  );
}

function ChartCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
      <h2 className="mb-4 text-sm font-medium text-zinc-400">{title}</h2>
      {children}
    </div>
  );
}
