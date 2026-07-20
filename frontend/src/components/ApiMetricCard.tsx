import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { StatusBadge, type ServiceStatus } from "./StatusBadge";
import { Activity, Clock, ShieldAlert, CheckCircle2, XCircle, Users } from "lucide-react";
import { clsx } from "clsx";

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
  if (Number.isNaN(d.getTime())) return "";
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
  return "#10b981"; // emerald-500
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

  const totalReqs = metrics.total_requests || 1;
  const successCount = metrics.success_count ?? Math.max(0, metrics.total_requests - Math.round(metrics.error_rate * metrics.total_requests));
  const failureCount = metrics.failure_count ?? Math.round(metrics.error_rate * metrics.total_requests);
  const otherCount = metrics.other_count ?? 0;

  const successPct = metrics.total_requests > 0 ? (successCount / totalReqs) * 100 : 100;
  const failurePct = metrics.total_requests > 0 ? (failureCount / totalReqs) * 100 : 0;
  const otherPct = metrics.total_requests > 0 ? (otherCount / totalReqs) * 100 : 0;

  return (
    <section className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/80 via-zinc-900/40 to-zinc-950/90 p-5 shadow-xl transition hover:border-zinc-700/80 ring-1 ring-white/[0.03]">
      {/* Top row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-bold tracking-tight text-white group-hover:text-emerald-300 transition-colors">
              {name}
            </h2>
          </div>
          {subtitle && (
            <p className="mt-0.5 truncate text-xs font-mono text-zinc-400" title={subtitle}>
              {subtitle}
            </p>
          )}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
            <Clock className="h-3 w-3 text-zinc-400" />
            Last active:{" "}
            <span className="font-medium text-zinc-300">
              {lastSeen ? new Date(lastSeen).toLocaleString() : "No traffic recorded"}
            </span>
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Primary KPI Grid */}
      <dl className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <MetricCell
          label="5m Realtime Error"
          value={`${(errorRate5m * 100).toFixed(1)}%`}
          highlight={errorRate5m > 0.05 ? "danger" : errorRate5m > 0 ? "warning" : "success"}
          subText={errorRate5m === 0 ? "0 failures (5m)" : "Active errors detected"}
        />
        <MetricCell
          label={`${windowLabel} Avg Error`}
          value={`${(metrics.error_rate * 100).toFixed(1)}%`}
          highlight={metrics.error_rate > 0.05 ? "danger" : metrics.error_rate > 0 ? "warning" : "success"}
          subText={`${failureCount.toLocaleString()} total errors`}
        />
        <MetricCell
          label="P50 Latency (Median)"
          value={`${metrics.p50} ms`}
          subText={metrics.p50 < 200 ? "Optimal speed" : metrics.p50 < 500 ? "Normal response" : "High latency"}
        />
        <MetricCell
          label="P95 Latency (Tail)"
          value={`${metrics.p95} ms`}
          subText="95% under this threshold"
        />
      </dl>

      {/* Outcome Proportion Ratio Bar */}
      <div className="mt-4 rounded-xl border border-zinc-800/60 bg-zinc-950/60 p-3">
        <div className="flex items-center justify-between text-xs font-medium text-zinc-400 mb-2">
          <span className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-emerald-400" />
            Outcome Distribution ({windowLabel})
          </span>
          <span className="text-zinc-300 font-semibold">{successPct.toFixed(1)}% Success Rate</span>
        </div>
        
        {/* Multi-segment progress bar */}
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-zinc-800">
          <div
            style={{ width: `${Math.max(0, successPct)}%` }}
            className="bg-emerald-500 transition-all duration-500"
            title={`Success: ${successCount.toLocaleString()} (${successPct.toFixed(1)}%)`}
          />
          <div
            style={{ width: `${Math.max(0, failurePct)}%` }}
            className="bg-rose-500 transition-all duration-500"
            title={`Failure: ${failureCount.toLocaleString()} (${failurePct.toFixed(1)}%)`}
          />
          <div
            style={{ width: `${Math.max(0, otherPct)}%` }}
            className="bg-amber-500 transition-all duration-500"
            title={`Other: ${otherCount.toLocaleString()} (${otherPct.toFixed(1)}%)`}
          />
        </div>

        {/* Legend pills */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              <strong className="font-semibold">{successCount.toLocaleString()}</strong> success
            </span>
            <span className="inline-flex items-center gap-1 text-rose-400">
              <XCircle className="h-3 w-3" />
              <strong className="font-semibold">{failureCount.toLocaleString()}</strong> failures
            </span>
            {otherCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-300">
                <ShieldAlert className="h-3 w-3" />
                <strong className="font-semibold">{otherCount.toLocaleString()}</strong> non-HTTP
              </span>
            )}
          </div>
          {(metrics.unique_users ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-800/80 px-2 py-0.5 text-zinc-300 font-medium">
              <Users className="h-3 w-3 text-cyan-400" />
              {metrics.unique_users} active user{metrics.unique_users === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Traffic Area Chart */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
            Volume trend ({windowLabel})
          </span>
          <span className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
            {metrics.total_requests.toLocaleString()} Total Calls
          </span>
        </div>
        <div className="relative h-32 min-h-[8rem] w-full min-w-0">
          {chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 text-xs text-zinc-500">
              No telemetry traffic recorded for this window
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={128}>
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
                    <stop offset="90%" stopColor={stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: "#a1a1aa" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <Tooltip
                  contentStyle={{
                    background: "#09090b",
                    border: "1px solid #27272a",
                    borderRadius: "10px",
                    fontSize: "12px",
                    boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.5)",
                    color: "#f4f4f5",
                  }}
                  formatter={(val: number) => [`${val.toLocaleString()} requests`, "Volume"]}
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

function MetricCell({
  label,
  value,
  subText,
  highlight,
}: {
  label: string;
  value: string;
  subText?: string;
  highlight?: "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-xl bg-zinc-950/80 p-3 ring-1 ring-zinc-800/80 flex flex-col justify-between">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
        {label}
      </dt>
      <dd
        className={clsx(
          "mt-1 text-xl font-bold tabular-nums tracking-tight",
          highlight === "danger"
            ? "text-rose-400"
            : highlight === "warning"
              ? "text-amber-300"
              : highlight === "success"
                ? "text-emerald-400"
                : "text-white"
        )}
      >
        {value}
      </dd>
      {subText && <p className="mt-0.5 text-[10px] text-zinc-500 font-medium truncate">{subText}</p>}
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
