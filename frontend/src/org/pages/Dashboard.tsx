import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta, problemKey } from "@/org/lib/metrics";
import type { FunnelStep, ProblemRow } from "@/org/types";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { InlineFunnel, JourneyFunnelViz } from "@/org/components/JourneyFunnelViz";
import { SystemHealthStrip } from "@/org/components/monitor";
import { SeverityBadge } from "@/org/components/monitor";
import { BarChart } from "@/org/components/charts";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { relativeTime } from "@/org/lib/journey";

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
  topProblems: ProblemRow[];
  funnel: FunnelStep[];
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
        <Panel className="lg:col-span-2">
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            User activity
            <span className="ml-2 text-xs font-normal text-zinc-400">
              {range.label}
            </span>
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
                    <SeverityBadge severity={p.severity} />
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
