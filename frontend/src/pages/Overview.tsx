import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiMetricCard } from "@/components/ApiMetricCard";
import { QuickActions } from "@/components/QuickActions";
import { StatCard } from "@/components/StatCard";
import { Skeleton } from "@/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMonitorSse } from "@/hooks/useMonitorSse";
import type { ServiceStatus } from "@/components/StatusBadge";
import { ArrowRight, Radio, Users, CheckCircle2, XCircle, AlertCircle, Activity } from "lucide-react";
import { clsx } from "clsx";

type DashboardRes = {
  window: string;
  summary: {
    unique_users: number;
    unique_sessions: number;
    total_requests: number;
    success_count: number;
    failure_count: number;
    other_count: number;
    failed_sessions_24h: number;
    open_incidents: number;
  };
  services: Record<
    string,
    {
      status: ServiceStatus;
      error_rate_5m: number;
      last_seen: string | null;
      p50: number;
      p95: number;
      total_requests: number;
      error_rate: number;
      sparkline: { bucket: string; count: number }[];
    }
  >;
  apis: {
    id: string;
    label: string;
    subtitle: string | null;
    status: ServiceStatus;
    error_rate_5m: number;
    error_rate_window: number;
    p50: number;
    p95: number;
    total_requests: number;
    success_count: number;
    failure_count: number;
    other_count: number;
    unique_users: number;
    last_seen: string | null;
    sparkline: { bucket: string; count: number }[];
  }[];
};

const WINDOWS = [
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
] as const;

export function Overview() {
  const { auth } = useAuth();
  const [windowId, setWindowId] =
    useState<(typeof WINDOWS)[number]["id"]>("6h");
  const [dash, setDash] = useState<DashboardRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!auth.token) return;
    setErr(null);
    try {
      const data = await apiFetch<DashboardRes>(
        `/metrics/dashboard?window=${windowId}`
      );
      setDash(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [auth.token, windowId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sse = useMonitorSse(load, !!auth.token);

  const services = ["DDIN", "MVEND"] as const;
  const summary = dash?.summary;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Overview
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            Real-time health for product lines, integrated APIs, and user impact —
            all metrics respect the selected time window.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={clsx(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
              sse.connected
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : sse.reconnecting
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : "border-zinc-700 bg-zinc-900 text-zinc-500"
            )}
          >
            <Radio
              className={clsx(
                "h-3.5 w-3.5",
                sse.connected && "text-emerald-400",
                sse.reconnecting && "animate-pulse text-amber-400"
              )}
            />
            {sse.connected ? "Live" : sse.reconnecting ? "Reconnecting" : "Idle"}
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs text-zinc-500">
            Window
            <select
              value={windowId}
              onChange={(e) =>
                setWindowId(e.target.value as typeof windowId)
              }
              className="bg-transparent text-sm font-medium text-zinc-100 outline-none"
            >
              {WINDOWS.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <QuickActions />

      {/* KPI row */}
      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          Platform summary ({windowId})
        </h2>
        {loading && !summary ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        ) : (
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <StatCard
              label="Total requests"
              value={summary?.total_requests.toLocaleString() ?? "0"}
              icon={Activity}
            />
            <StatCard
              label="Unique users"
              value={summary?.unique_users.toLocaleString() ?? "0"}
              icon={Users}
              tone="accent"
            />
            <StatCard
              label="Sessions"
              value={summary?.unique_sessions.toLocaleString() ?? "0"}
              tone="default"
            />
            <StatCard
              label="Success"
              value={summary?.success_count.toLocaleString() ?? "0"}
              tone="success"
              icon={CheckCircle2}
            />
            <StatCard
              label="Failures"
              value={summary?.failure_count.toLocaleString() ?? "0"}
              tone="danger"
              icon={XCircle}
            />
            <StatCard
              label="Other (no HTTP)"
              value={summary?.other_count.toLocaleString() ?? "0"}
              tone="warning"
              icon={AlertCircle}
            />
            <StatCard
              label="Failed sessions (24h)"
              value={summary?.failed_sessions_24h ?? 0}
              sub={`${summary?.open_incidents ?? 0} open incidents`}
              tone="danger"
            />
          </dl>
        )}
      </section>

      {/* Product lines */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-400">Product lines</h2>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {loading && !dash ? (
            <>
              <Skeleton className="h-[420px]" />
              <Skeleton className="h-[420px]" />
            </>
          ) : (
            services.map((svc) => {
              const s = dash?.services[svc];
              return (
                <ApiMetricCard
                  key={svc}
                  chartId={`svc-${svc}`}
                  name={svc}
                  status={s?.status ?? "operational"}
                  errorRate5m={s?.error_rate_5m ?? 0}
                  lastSeen={s?.last_seen ?? null}
                  windowLabel={windowId}
                  metrics={{
                    p50: s?.p50 ?? 0,
                    p95: s?.p95 ?? 0,
                    total_requests: s?.total_requests ?? 0,
                    error_rate: s?.error_rate ?? 0,
                  }}
                  volume={s?.sparkline ?? []}
                />
              );
            })
          )}
        </div>
      </section>

      {/* Unique APIs */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-zinc-400">Integrated APIs</h2>
            <p className="mt-0.5 text-xs text-zinc-600">
              Each unique upstream — reference APIs plus discovered{" "}
              <code className="text-zinc-500">upstream_key</code> values
            </p>
          </div>
          <Link
            to="/endpoints"
            className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300"
          >
            All endpoints
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        {loading && !dash ? (
          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-2">
            <Skeleton className="h-[420px]" />
            <Skeleton className="h-[420px]" />
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            {(dash?.apis ?? []).map((api) => (
              <ApiMetricCard
                key={api.id}
                chartId={api.id}
                name={api.label}
                subtitle={api.subtitle}
                status={api.status}
                errorRate5m={api.error_rate_5m}
                lastSeen={api.last_seen}
                windowLabel={windowId}
                metrics={{
                  p50: api.p50,
                  p95: api.p95,
                  total_requests: api.total_requests,
                  error_rate: api.error_rate_window,
                  success_count: api.success_count,
                  failure_count: api.failure_count,
                  other_count: api.other_count,
                  unique_users: api.unique_users,
                }}
                volume={api.sparkline}
              />
            ))}
          </div>
        )}
      </section>

      {/* Incidents strip */}
      {(summary?.open_incidents ?? 0) > 0 && (
        <section className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-amber-200">
              <span className="font-semibold">{summary?.open_incidents}</span> open
              incident{(summary?.open_incidents ?? 0) === 1 ? "" : "s"} require attention.
            </p>
            <Link
              to="/incidents"
              className="text-sm font-medium text-amber-400 hover:text-amber-300"
            >
              View incidents →
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
