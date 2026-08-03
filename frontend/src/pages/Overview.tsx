import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiMetricCard } from "@/components/ApiMetricCard";
import { QuickActions } from "@/components/QuickActions";
import { Skeleton } from "@/components/Skeleton";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useMonitorSse } from "@/hooks/useMonitorSse";
import { StatusBadge, type ServiceStatus } from "@/components/StatusBadge";
import {
  ArrowRight,
  Radio,
  Users,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  Layers,
  Server,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  Info,
  ChevronDown,
  BookOpen,
} from "lucide-react";
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
  { id: "1h", label: "1 Hour", desc: "Past 60 mins" },
  { id: "6h", label: "6 Hours", desc: "Past 6 hrs" },
  { id: "24h", label: "24 Hours", desc: "Past 1 day" },
  { id: "7d", label: "7 Days", desc: "Past 1 week" },
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
      setErr(e instanceof Error ? e.message : "Failed to load dashboard metrics");
    } finally {
      setLoading(false);
    }
  }, [auth.token, windowId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sse = useMonitorSse(load, !!auth.token);

  const services = ["DDIN", "MVEND", "KORALINK"] as const;
  const SERVICE_LABELS: Record<(typeof services)[number], string> = {
    DDIN: "DDIN Digital Services API",
    MVEND: "MVEND / Gwiza Payments API",
    KORALINK: "Koralink Core API",
  };
  const summary = dash?.summary;

  // Exact calculations for overall system health
  const totalReqs = summary?.total_requests ?? 0;
  const successCount = summary?.success_count ?? 0;
  const failureCount = summary?.failure_count ?? 0;
  const otherCount = summary?.other_count ?? 0;
  
  const successRate = totalReqs > 0 ? (successCount / totalReqs) * 100 : 100;
  const failureRate = totalReqs > 0 ? (failureCount / totalReqs) * 100 : 0;

  // Determine overall global health status
  const openIncidents = summary?.open_incidents ?? 0;
  const anyDown = services.some((s) => dash?.services[s]?.status === "down");
  const anyDegraded = services.some((s) => dash?.services[s]?.status === "degraded");

  const globalStatus: "operational" | "degraded" | "down" = anyDown
    ? "down"
    : anyDegraded || openIncidents > 0
      ? "degraded"
      : "operational";

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Header & Control Bar */}
      <div className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-950 p-6 shadow-2xl ring-1 ring-white/[0.04]">
        <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute -left-12 -bottom-12 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-3 py-1 text-xs font-semibold text-emerald-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                API Telemetry & Health Monitoring
              </span>
              
              {/* Real-time SSE Live Indicator */}
              <div
                className={clsx(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                  sse.connected
                    ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300 shadow-sm shadow-emerald-500/20"
                    : sse.reconnecting
                      ? "border-amber-500/30 bg-amber-500/15 text-amber-300 shadow-sm shadow-amber-500/20"
                      : "border-zinc-700 bg-zinc-900 text-zinc-400"
                )}
              >
                <Radio
                  className={clsx(
                    "h-3.5 w-3.5",
                    sse.connected && "text-emerald-400 animate-pulse",
                    sse.reconnecting && "text-amber-400 animate-bounce"
                  )}
                />
                {sse.connected ? "Realtime SSE Active" : sse.reconnecting ? "Reconnecting..." : "Offline"}
              </div>
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              System Overview & Operations
            </h1>
            <p className="max-w-3xl text-sm text-zinc-400 leading-relaxed">
              Monitoring real-time API uptime, response latencies, and user session reliability across{" "}
              <strong className="text-zinc-200">DDIN</strong>, <strong className="text-zinc-200">MVEND</strong> &amp; <strong className="text-zinc-200">KORALINK</strong> product lines and integrated upstream services.
            </p>
          </div>

          {/* Time Window Pills Bar */}
          <div className="flex flex-col items-start gap-2 lg:items-end">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Select Time Window
            </span>
            <div className="inline-flex rounded-xl border border-zinc-800 bg-zinc-950/80 p-1.5 ring-1 ring-white/[0.04]">
              {WINDOWS.map((w) => {
                const isActive = windowId === w.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => setWindowId(w.id)}
                    className={clsx(
                      "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-200",
                      isActive
                        ? "bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/20 font-bold"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800/60"
                    )}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Global Status Banner Card */}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-zinc-800/90 bg-zinc-950/70 p-4">
          <div className="flex items-center gap-3">
            <div
              className={clsx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1",
                globalStatus === "operational"
                  ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/30"
                  : globalStatus === "degraded"
                    ? "bg-amber-500/10 text-amber-300 ring-amber-500/30"
                    : "bg-rose-500/10 text-rose-400 ring-rose-500/30"
              )}
            >
              {globalStatus === "operational" ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : globalStatus === "degraded" ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white uppercase tracking-wide">
                  {globalStatus === "operational"
                    ? "All Product Lines Operational"
                    : globalStatus === "degraded"
                      ? "Partial Service Degradation Detected"
                      : "Critical System Outage"}
                </span>
                <span
                  className={clsx(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                    globalStatus === "operational"
                      ? "bg-emerald-500/20 text-emerald-300"
                      : globalStatus === "degraded"
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-rose-500/20 text-rose-300"
                  )}
                >
                  {globalStatus}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {openIncidents > 0
                  ? `${openIncidents} active incident${openIncidents === 1 ? "" : "s"} currently under investigation`
                  : "All API contracts and latency SLA benchmarks are operating within normal parameters."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="text-right">
              <span className="block text-zinc-500 text-[10px] uppercase font-semibold">Window Success</span>
              <span className="text-sm font-bold text-emerald-400 tabular-nums">
                {successRate.toFixed(1)}%
              </span>
            </div>
            <div className="h-8 w-px bg-zinc-800" />
            <div className="text-right">
              <span className="block text-zinc-500 text-[10px] uppercase font-semibold">Total Calls ({windowId})</span>
              <span className="text-sm font-bold text-white tabular-nums">
                {totalReqs.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Visitor-friendly explainer / glossary — collapsible, defaults closed so it stays out of the way for returning staff */}
      <details className="group overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-900/40 transition-colors open:bg-zinc-900/60">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 select-none">
          <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
            <BookOpen className="h-4 w-4 text-cyan-400" />
            New here? What am I looking at &amp; how to read this dashboard
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-180" />
        </summary>

        <div className="space-y-5 border-t border-zinc-800/80 p-5 text-sm text-zinc-400">
          <div>
            <h3 className="mb-1 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
              <Info className="h-3.5 w-3.5 text-emerald-400" />
              What this monitors
            </h3>
            <p className="leading-relaxed">
              Koralink Monitor watches every API call the Koralink marketplace app makes across
              three backend product lines: <strong className="text-zinc-200">DDIN</strong>{" "}
              (digital financial services), <strong className="text-zinc-200">MVEND / Gwiza</strong>{" "}
              (wallet &amp; payments), and <strong className="text-zinc-200">KORALINK</strong> (the
              core marketplace API). Every request is captured in real time — via direct
              instrumentation and Sentry — and classified as a{" "}
              <span className="font-semibold text-emerald-400">success</span>,{" "}
              <span className="font-semibold text-rose-400">failure</span>, or{" "}
              <span className="font-semibold text-amber-300">other</span> (network/timeout)
              outcome, so problems can be caught before too many users notice.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                Status colors
              </h3>
              <ul className="space-y-2">
                <li className="flex items-center gap-2">
                  <StatusBadge status="operational" />
                  <span>Error rate is low and within normal range</span>
                </li>
                <li className="flex items-center gap-2">
                  <StatusBadge status="degraded" />
                  <span>Elevated errors, or an incident is under investigation</span>
                </li>
                <li className="flex items-center gap-2">
                  <StatusBadge status="down" />
                  <span>Most recent requests to this service are failing</span>
                </li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
                Key terms
              </h3>
              <dl className="space-y-1.5">
                <div>
                  <dt className="inline font-semibold text-zinc-200">P50 (median):</dt>{" "}
                  <dd className="inline">half of all requests finished faster than this.</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-zinc-200">P95 (tail):</dt>{" "}
                  <dd className="inline">
                    95% of requests finished faster than this — a good proxy for the
                    "worst-case" experience.
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-zinc-200">Error rate:</dt>{" "}
                  <dd className="inline">
                    share of calls that returned a failure or non-2xx response.
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-zinc-200">Open incidents:</dt>{" "}
                  <dd className="inline">
                    auto-raised when a service's error rate crosses its threshold; cleared once
                    it recovers or an analyst resolves it.
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wider text-zinc-300">
              Where to go next
            </h3>
            <ul className="grid gap-1.5 sm:grid-cols-2">
              <li>
                <Link to="/incidents" className="font-medium text-emerald-400 hover:underline">
                  Incidents
                </Link>{" "}
                — investigate active or past error-rate breaches.
              </li>
              <li>
                <Link to="/events" className="font-medium text-emerald-400 hover:underline">
                  Event log
                </Link>{" "}
                — see every individual raw API call recorded.
              </li>
              <li>
                <Link to="/endpoints" className="font-medium text-emerald-400 hover:underline">
                  Endpoints
                </Link>{" "}
                — drill into a specific upstream URL or path.
              </li>
              <li>
                <Link
                  to="/monitoring/sessions"
                  className="font-medium text-emerald-400 hover:underline"
                >
                  Sessions
                </Link>{" "}
                — replay one user's sequence of actions end-to-end.
              </li>
            </ul>
          </div>
        </div>
      </details>

      {err && (
        <div className="flex items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <AlertCircle className="h-5 w-5 shrink-0 text-rose-400" />
          <span>{err}</span>
        </div>
      )}

      {/* Primary Executive KPI Metric Grid */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-300">
            <Activity className="h-4 w-4 text-emerald-400" />
            Platform Performance Metrics ({windowId} Window)
          </h2>
          <span className="text-xs text-zinc-500">Live statistics computed from ingested telemetry</span>
        </div>

        {loading && !summary ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {/* Card 1: API Request Volume & Success Rate */}
            <div className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950/80 p-5 shadow-lg ring-1 ring-white/[0.03] transition hover:border-zinc-700">
              <div className="flex items-start justify-between">
                <div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    title="Total number of API calls recorded across DDIN, MVEND, and KORALINK during the selected time window."
                  >
                    Total API Volume
                  </span>
                  <dd className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight text-white">
                    {totalReqs.toLocaleString()}
                  </dd>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </div>

              {/* Success progress bar */}
              <div className="mt-4 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-semibold">
                  <span className="text-emerald-400">{successRate.toFixed(1)}% Success</span>
                  <span className="text-rose-400">{failureRate.toFixed(1)}% Failures</span>
                </div>
                <div className="flex h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div
                    style={{ width: `${Math.max(0, successRate)}%` }}
                    className="bg-emerald-500 transition-all duration-500"
                  />
                  <div
                    style={{ width: `${Math.max(0, failureRate)}%` }}
                    className="bg-rose-500 transition-all duration-500"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-zinc-400 pt-0.5">
                  <span>{successCount.toLocaleString()} ok</span>
                  <span>{failureCount.toLocaleString()} errors</span>
                </div>
              </div>
            </div>

            {/* Card 2: User Footprint */}
            <div className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950/80 p-5 shadow-lg ring-1 ring-white/[0.03] transition hover:border-zinc-700">
              <div className="flex items-start justify-between">
                <div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    title="Count of distinct users who made at least one API call in this window, based on their user ID."
                  >
                    Unique Active Users
                  </span>
                  <dd className="mt-1 text-3xl font-extrabold tabular-nums tracking-tight text-cyan-300">
                    {summary?.unique_users.toLocaleString() ?? "0"}
                  </dd>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20">
                  <Users className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Total User Sessions:</span>
                <span className="font-bold text-white tabular-nums">
                  {summary?.unique_sessions.toLocaleString() ?? "0"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-zinc-400">
                Avg ~{summary?.unique_users ? Math.round(totalReqs / summary.unique_users) : 0} API actions per active user
              </p>
            </div>

            {/* Card 3: Session Reliability */}
            <div className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950/80 p-5 shadow-lg ring-1 ring-white/[0.03] transition hover:border-zinc-700">
              <div className="flex items-start justify-between">
                <div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    title="Sessions in the last 24 hours where the user encountered at least one failed or non-HTTP (other) outcome."
                  >
                    Failed Sessions (24h)
                  </span>
                  <dd
                    className={clsx(
                      "mt-1 text-3xl font-extrabold tabular-nums tracking-tight",
                      (summary?.failed_sessions_24h ?? 0) > 0 ? "text-rose-400" : "text-emerald-400"
                    )}
                  >
                    {summary?.failed_sessions_24h ?? 0}
                  </dd>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20">
                  <XCircle className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-4 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-xs">
                <span className="text-zinc-400">Open Incidents:</span>
                <span
                  className={clsx(
                    "font-bold tabular-nums",
                    openIncidents > 0 ? "text-amber-400" : "text-emerald-400"
                  )}
                >
                  {openIncidents} active
                </span>
              </div>
              <p className="mt-1 text-[11px] text-zinc-400 truncate">
                {otherCount > 0 ? `${otherCount.toLocaleString()} non-HTTP timeout/network errors` : "No network exceptions"}
              </p>
            </div>

            {/* Card 4: Platform Services Uptime */}
            <div className="group relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/90 to-zinc-950/80 p-5 shadow-lg ring-1 ring-white/[0.03] transition hover:border-zinc-700">
              <div className="flex items-start justify-between">
                <div>
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider text-zinc-400"
                    title="Number of backend product lines being tracked and how many currently show a healthy (operational) status."
                  >
                    Core Product Lines
                  </span>
                  <dd className="mt-1 text-3xl font-extrabold tracking-tight text-white">
                    {services.length} / {services.length}
                  </dd>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                  <Server className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                {services.map((svc) => (
                  <div key={svc} className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="font-semibold text-zinc-200">{svc}:</span>
                    <span className="text-emerald-400 font-bold uppercase text-[10px]">
                      {dash?.services[svc]?.status ?? "Operational"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-400">
                5m Error Rate:{" "}
                {services.map((svc, i) => (
                  <span key={svc}>
                    <strong className="text-zinc-200">
                      {((dash?.services[svc]?.error_rate_5m ?? 0) * 100).toFixed(1)}%
                    </strong>{" "}
                    ({svc}){i < services.length - 1 ? " / " : ""}
                  </span>
                ))}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Navigation Quick Action Grid */}
      <QuickActions />

      {/* Product Line Performance Section (DDIN, MVEND & KORALINK) */}
      <section className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Layers className="h-5 w-5 text-emerald-400" />
              Core Product Line Health
            </h2>
            <p className="text-xs text-zinc-400">
              Aggregated telemetry for primary application services — <strong className="text-zinc-300">DDIN</strong> (Digital Services API), <strong className="text-zinc-300">MVEND</strong> (Gwiza Digital Payments API), and <strong className="text-zinc-300">KORALINK</strong> (Core API)
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {loading && !dash ? (
            <>
              <Skeleton className="h-[440px]" />
              <Skeleton className="h-[440px]" />
              <Skeleton className="h-[440px]" />
            </>
          ) : (
            services.map((svc) => {
              const s = dash?.services[svc];
              return (
                <ApiMetricCard
                  key={svc}
                  chartId={`svc-${svc}`}
                  name={SERVICE_LABELS[svc]}
                  subtitle={`Service Code: ${svc}`}
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

      {/* Integrated Upstream APIs Section */}
      <section className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold text-white">
              <Server className="h-5 w-5 text-cyan-400" />
              Tracked & Discovered Upstream APIs
            </h2>
            <p className="text-xs text-zinc-400">
              Individual upstream endpoints discovered from client requests and reference API integrations
            </p>
          </div>
          <Link
            to="/endpoints"
            className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
          >
            Explore all endpoints
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {loading && !dash ? (
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-[440px]" />
            <Skeleton className="h-[440px]" />
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

      {/* Incidents Alert Footer Strip */}
      {(summary?.open_incidents ?? 0) > 0 && (
        <section className="rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-zinc-950 p-5 shadow-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-200">
                  {summary?.open_incidents} Active Incident{summary?.open_incidents === 1 ? "" : "s"} Require Action
                </h3>
                <p className="text-xs text-amber-300/80">
                  Error rate threshold violations detected on product lines. Inspect active tickets and notes.
                </p>
              </div>
            </div>
            <Link
              to="/incidents"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 shadow-md transition hover:bg-amber-400"
            >
              Investigate Incidents
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
