import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { StatusBadge, type ServiceStatus } from "./StatusBadge";

export type ApiMetrics = {
  p50: number;
  p95: number;
  total_requests: number;
  error_rate: number;
  success_count?: number;
  failure_count?: number;
  other_count?: number;
  unique_users?: number;
};

function formatChartTick(bucketIso: string, windowId: string): string {
  const d = new Date(bucketIso);
  if (windowId === "7d") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  if (windowId === "24h" || windowId === "6h") {
    return d.toLocaleString([], {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function chartStroke(status: ServiceStatus): string {
  if (status === "down") return "#f87171";
  if (status === "degraded") return "#fbbf24";
  return "#34d399";
}

export function ApiMetricCard({
  name,
  subtitle,
  status,
  errorRate5m,
  lastSeen,
  windowLabel,
  metrics,
  volume,
  chartId,
}: {
  name: string;
  subtitle?: string | null;
  status: ServiceStatus;
  errorRate5m: number;
  lastSeen: string | null;
  windowLabel: string;
  metrics: ApiMetrics;
  volume: { bucket: string; count: number }[];
  chartId: string;
}) {
  const chartData = volume.map((v) => ({
    t: formatChartTick(v.bucket, windowLabel),
    count: v.count,
  }));
  const stroke = chartStroke(status);
  const gradId = `g-${chartId.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <section className="rounded-xl border border-zinc-800 bg-gradient-to-b from-zinc-900/60 to-zinc-950/40 p-5 shadow-lg shadow-black/25 ring-1 ring-white/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight text-white">
            {name}
          </h2>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs text-zinc-500" title={subtitle}>
              {subtitle}
            </p>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            Last seen{" "}
            <span className="text-zinc-400">
              {lastSeen
                ? new Date(lastSeen).toLocaleString()
                : "No traffic yet"}
            </span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCell label="5m error rate" value={`${(errorRate5m * 100).toFixed(1)}%`} />
        <MetricCell
          label={`${windowLabel} error rate`}
          value={`${(metrics.error_rate * 100).toFixed(1)}%`}
        />
        <MetricCell label="p50 latency" value={`${metrics.p50} ms`} />
        <MetricCell label="p95 latency" value={`${metrics.p95} ms`} />
      </dl>

      {(metrics.success_count !== undefined ||
        metrics.failure_count !== undefined) && (
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {metrics.success_count !== undefined && (
            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-emerald-400">
              {metrics.success_count.toLocaleString()} success
            </span>
          )}
          {metrics.failure_count !== undefined && (
            <span className="rounded-md bg-red-500/10 px-2 py-0.5 text-red-300">
              {metrics.failure_count.toLocaleString()} failure
            </span>
          )}
          {(metrics.other_count ?? 0) > 0 && (
            <span className="rounded-md bg-amber-500/10 px-2 py-0.5 text-amber-200">
              {metrics.other_count!.toLocaleString()} other
            </span>
          )}
          {(metrics.unique_users ?? 0) > 0 && (
            <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-zinc-400">
              {metrics.unique_users} users
            </span>
          )}
        </div>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">
            Requests ({windowLabel} window)
          </span>
          <span className="text-xs text-zinc-600">
            {metrics.total_requests.toLocaleString()} reqs ({windowLabel})
          </span>
        </div>
        <div className="relative h-32 min-h-[8rem] w-full min-w-0">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 text-xs text-zinc-500">
              No requests in this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={128}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: "#71717a" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <Tooltip
                  contentStyle={{
                    background: "#18181b",
                    border: "1px solid #27272a",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke={stroke}
                  strokeWidth={2}
                  fill={`url(#${gradId})`}
                  isAnimationActive={false}
                  dot={false}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </section>
  );
}

function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-950/70 p-3 ring-1 ring-zinc-800/80">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-white">{value}</dd>
    </div>
  );
}

/** @deprecated use ApiMetricCard */
export function ServiceCard(props: {
  name: string;
  status: ServiceStatus;
  errorRate5m: number;
  lastSeen: string | null;
  windowLabel: string;
  metrics: ApiMetrics;
  volume: { bucket: string; count: number }[];
}) {
  return (
    <ApiMetricCard
      {...props}
      chartId={props.name}
      metrics={props.metrics}
    />
  );
}
