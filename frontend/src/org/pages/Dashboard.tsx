import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { clsx } from "clsx";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta, problemKey } from "@/org/lib/metrics";
import type { FunnelStep, ProblemRow } from "@/org/types";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { InlineFunnel, JourneyFunnelViz } from "@/org/components/JourneyFunnelViz";
import { SystemHealthStrip } from "@/org/components/monitor";
import { ResultClassBadge, SeverityBadge } from "@/org/components/monitor";
import { BarChart, DonutChart, StackedOutcomeBars } from "@/org/components/charts";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { relativeTime } from "@/org/lib/journey";

type ApiOpsRow = {
  service: string;
  host: string | null;
  total: number;
  success: number;
  clientFailure: number;
  serverError: number;
  network: number;
  status: "healthy" | "degraded" | "critical" | "idle";
};

type ApiRequestRow = {
  method: string;
  path: string;
  total: number;
  success: number;
  clientFailure: number;
  serverError: number;
  network: number;
  lastSeen: string;
};

type Dashboard = {
  hasEvents: boolean;
  health: {
    status: string;
    availability: number;
    availabilityDelta: number | null;
    avgLatencyMs: number;
    latencyDelta: number | null;
    errorRate: number;
    errorRateDelta: number | null;
  };
  kpis: {
    users: number;
    sessions: number;
    actions: number;
    apiRequests: number;
    errors: number;
    usersDelta: number | null;
    sessionsDelta: number | null;
    actionsDelta: number | null;
    apisDelta: number | null;
    errorsDelta: number | null;
  };
  activity: { label: string; count: number }[];
  activityUnit: "hour" | "day";
  apiOutcomes: {
    success: number;
    clientFailure: number;
    serverError: number;
    network: number;
  };
  apiOps: ApiOpsRow[];
  apiRequestOutcomes: ApiRequestRow[];
  topProblems: ProblemRow[];
  funnel: FunnelStep[];
};

const STATUS_PILL: Record<ApiOpsRow["status"], string> = {
  healthy: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  degraded: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  critical: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  idle: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function DashboardPage() {
  const { orgId, projectId } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<Dashboard | null>(null);
  const [projectName, setProjectName] = useState("Project");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setRefreshing(true);
    try {
      const [dash, project] = await Promise.all([
        apiFetch<Dashboard>(`/console/projects/${projectId}/dashboard?${range.query}`),
        apiFetch<{ name: string }>(`/console/projects/${projectId}`),
      ]);
      setData(dash);
      setProjectName(project.name);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setRefreshing(false);
    }
  }, [projectId, range.query]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const base = `/orgs/${orgId}/projects/${projectId}`;
  const outcomes = data.apiOutcomes ?? {
    success: 0,
    clientFailure: 0,
    serverError: 0,
    network: 0,
  };
  const outcomeTotal =
    outcomes.success + outcomes.clientFailure + outcomes.serverError + outcomes.network;

  return (
    <div>
      <PageHeader
        eyebrow="Monitor"
        title="Overview"
        description="How healthy is your application today?"
        actions={
          <>
            <span className="hidden text-sm font-medium text-zinc-600 dark:text-zinc-300 sm:inline">
              {projectName}
            </span>
            <TimeRangePicker />
            <button type="button" className="btn-secondary" disabled={refreshing} onClick={() => void load()}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </>
        }
      />
      {!data.hasEvents && (
        <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Waiting for the first ingest event.{" "}
          <Link className="font-medium underline" to={`${base}/integration`}>
            Open Integrations
          </Link>
        </div>
      )}

      <div className="mb-6">
        <SystemHealthStrip {...data.health} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Users" value={data.kpis.users.toLocaleString()} hint={<Delta value={data.kpis.usersDelta} />} />
        <StatCard label="Sessions" value={data.kpis.sessions.toLocaleString()} hint={<Delta value={data.kpis.sessionsDelta} />} />
        <StatCard label="Actions" value={data.kpis.actions.toLocaleString()} hint={<Delta value={data.kpis.actionsDelta} />} />
        <StatCard
          label="API requests"
          value={data.kpis.apiRequests.toLocaleString()}
          hint={<Delta value={data.kpis.apisDelta} />}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Request outcomes
            <p className="mt-0.5 text-xs font-normal text-zinc-400">
              Success · client failure · 5xx · network (status 0 uses outcome)
            </p>
          </div>
          <div className="p-5">
            {outcomeTotal === 0 ? (
              <EmptyState title="No API calls" body="Ingested HTTP calls will classify here." />
            ) : (
              <DonutChart
                center={outcomeTotal.toLocaleString()}
                slices={[
                  { label: "Success", value: outcomes.success, color: "#22c55e" },
                  { label: "Client failure", value: outcomes.clientFailure, color: "#f59e0b" },
                  { label: "Server error", value: outcomes.serverError, color: "#ef4444" },
                  { label: "Network", value: outcomes.network, color: "#64748b" },
                ].filter((s) => s.value > 0)}
              />
            )}
          </div>
        </Panel>
        <Panel className="lg:col-span-2">
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <div>
              <span className="text-sm font-medium">API operational status</span>
              <p className="text-xs font-normal text-zinc-400">All upstream APIs in this range</p>
            </div>
            <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/apis`}>
              API Monitor →
            </Link>
          </div>
          <div className="p-5">
            {(data.apiOps ?? []).length === 0 ? (
              <EmptyState title="No upstream traffic" body="Calls to labeled hosts appear here." />
            ) : (
              <div className="space-y-4">
                <ul className="flex flex-wrap gap-2">
                  {(data.apiOps ?? []).map((a) => (
                    <li
                      key={`${a.service}-${a.host}`}
                      className={clsx(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize",
                        STATUS_PILL[a.status]
                      )}
                    >
                      {a.service}: {a.status}
                    </li>
                  ))}
                </ul>
                <StackedOutcomeBars
                  rows={(data.apiOps ?? []).map((a) => ({
                    label: a.host ? `${a.service} · ${a.host}` : a.service,
                    hint: `${a.total.toLocaleString()} calls`,
                    success: a.success,
                    clientFailure: a.clientFailure,
                    serverError: a.serverError,
                    network: a.network,
                  }))}
                />
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="mb-6">
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            API requests by outcome
            <p className="mt-0.5 text-xs font-normal text-zinc-400">
              Top endpoints with success / client failure / server error / network mix
            </p>
          </div>
          {(data.apiRequestOutcomes ?? []).length === 0 ? (
            <EmptyState title="No endpoints yet" body="Individual API paths will list here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="table-head">
                  <tr>
                    <th className="px-5 py-2">Request</th>
                    <th className="px-5 py-2">Total</th>
                    <th className="px-5 py-2">Success</th>
                    <th className="px-5 py-2">Client</th>
                    <th className="px-5 py-2">5xx</th>
                    <th className="px-5 py-2">Network</th>
                    <th className="px-5 py-2">Mix</th>
                    <th className="px-5 py-2">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.apiRequestOutcomes ?? []).map((r) => {
                    const total = Math.max(1, r.total);
                    return (
                      <tr key={`${r.method}-${r.path}`} className="border-b border-zinc-100 dark:border-zinc-800">
                        <td className="max-w-md truncate px-5 py-3 font-mono text-xs">
                          <span className="text-zinc-400">{r.method}</span> {r.path}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{r.total.toLocaleString()}</td>
                        <td className="px-5 py-3 tabular-nums text-emerald-700 dark:text-emerald-400">
                          {r.success.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 tabular-nums text-amber-700 dark:text-amber-400">
                          {r.clientFailure.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 tabular-nums text-red-600 dark:text-red-400">
                          {r.serverError.toLocaleString()}
                        </td>
                        <td className="px-5 py-3 tabular-nums text-zinc-500">{r.network.toLocaleString()}</td>
                        <td className="px-5 py-3">
                          <div className="flex h-2 w-28 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                            {r.success > 0 && (
                              <div style={{ width: `${(r.success / total) * 100}%`, background: "#22c55e" }} />
                            )}
                            {r.clientFailure > 0 && (
                              <div
                                style={{ width: `${(r.clientFailure / total) * 100}%`, background: "#f59e0b" }}
                              />
                            )}
                            {r.serverError > 0 && (
                              <div
                                style={{ width: `${(r.serverError / total) * 100}%`, background: "#ef4444" }}
                              />
                            )}
                            {r.network > 0 && (
                              <div style={{ width: `${(r.network / total) * 100}%`, background: "#64748b" }} />
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-xs text-zinc-500">{relativeTime(r.lastSeen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            User activity
            <span className="ml-2 text-xs font-normal text-zinc-400">{range.label}</span>
          </div>
          <div className="p-4">
            <BarChart
              values={data.activity.map((a) => a.count)}
              labels={data.activity.map((a) =>
                data.activityUnit === "hour" ? `${a.label}:00` : a.label.slice(5)
              )}
            />
          </div>
        </Panel>
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            User journey
          </div>
          <div className="p-5">
            {data.funnel.length === 0 ? (
              <EmptyState title="No funnel yet" body="Send navigation events with from_screen." />
            ) : (
              <InlineFunnel steps={data.funnel} />
            )}
            {data.funnel.length > 0 && (
              <Link className="mt-4 inline-block text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/funnels`}>
                View funnel report →
              </Link>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <span className="text-sm font-medium">Top problems</span>
            <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/problems`}>
              View all →
            </Link>
          </div>
          {data.topProblems.length === 0 ? (
            <EmptyState title="No failures" body="Failed API calls will appear here." />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.topProblems.map((p) => (
                <li key={problemKey(p)} className="px-5 py-4">
                  <Link
                    to={`${base}/problems/${problemKey(p)}`}
                    className="block hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={p.severity} />
                      <ResultClassBadge resultClass={p.resultClass} />
                    </div>
                    <p className="mt-1 font-mono text-xs">
                      {p.method} {p.path}
                    </p>
                    <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                      {p.occurrences} errors · {p.usersAffected} users
                    </p>
                    <p className="text-xs text-zinc-500">Last seen {relativeTime(p.lastSeen)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <JourneyFunnelViz steps={data.funnel} />
      </div>
    </div>
  );
}
