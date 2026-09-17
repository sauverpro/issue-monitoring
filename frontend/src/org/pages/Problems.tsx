import { useEffect, useMemo, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { clsx } from "clsx";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta, problemKey } from "@/org/lib/metrics";
import type { HttpResultClass, ProblemRow } from "@/org/types";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { ImpactBar, ResultClassBadge, SeverityBadge } from "@/org/components/monitor";
import { DonutChart } from "@/org/components/charts";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { formatLatency, relativeTime } from "@/org/lib/journey";

type ClassFilter = "all" | "server_error" | "client_failure" | "network";

type ProblemsPayload = {
  summary: {
    totalErrors: number;
    totalErrorsDelta: number | null;
    usersAffected: number;
    usersAffectedDelta: number | null;
    errors5xx: number;
    errors5xxDelta: number | null;
    clientFailures?: number;
    clientFailuresDelta?: number | null;
    networkErrors?: number;
    networkErrorsDelta?: number | null;
    critical: number;
  };
  byClass?: {
    clientFailure: number;
    serverError: number;
    network: number;
  };
  priority: Record<string, number>;
  errors: ProblemRow[];
  slow: {
    method: string;
    path: string;
    occurrences: number;
    avgLatencyMs: number;
    p95Ms: number;
    lastSeen: string;
  }[];
};

const FILTERS: { id: ClassFilter; label: string }[] = [
  { id: "all", label: "All problems" },
  { id: "server_error", label: "Server error" },
  { id: "client_failure", label: "Client failure" },
  { id: "network", label: "Network" },
];

export function ProblemsPage() {
  const { orgId, projectId } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<ProblemsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ClassFilter>("all");

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setData(await apiFetch<ProblemsPayload>(`/console/projects/${projectId}/problems?${range.query}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [projectId, range.query]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (filter === "all") return data.errors;
    return data.errors.filter((e) => e.resultClass === filter);
  }, [data, filter]);

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const base = `/orgs/${orgId}/projects/${projectId}`;
  const byClass = data.byClass ?? {
    clientFailure: data.summary.clientFailures ?? 0,
    serverError: data.summary.errors5xx,
    network: data.summary.networkErrors ?? 0,
  };
  const classTotal = byClass.clientFailure + byClass.serverError + byClass.network;

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="Errors"
        description="Problems classified as client failure, server error (5xx), or network — including status 0 with SUCCESS/FAILURE outcomes."
        actions={<TimeRangePicker />}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total problems"
          value={data.summary.totalErrors.toLocaleString()}
          hint={<Delta value={data.summary.totalErrorsDelta} invert />}
        />
        <StatCard
          label="Server errors (5xx)"
          value={byClass.serverError.toLocaleString()}
          hint={<Delta value={data.summary.errors5xxDelta} invert />}
        />
        <StatCard
          label="Client failures"
          value={byClass.clientFailure.toLocaleString()}
          hint={<Delta value={data.summary.clientFailuresDelta ?? null} invert />}
        />
        <StatCard
          label="Network"
          value={byClass.network.toLocaleString()}
          hint={<Delta value={data.summary.networkErrorsDelta ?? null} invert />}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Problem mix
          </div>
          <div className="p-5">
            {classTotal === 0 ? (
              <EmptyState title="No problems" body="Failed and network calls will classify here." />
            ) : (
              <DonutChart
                center={classTotal.toLocaleString()}
                slices={[
                  { label: "Server error", value: byClass.serverError, color: "#ef4444" },
                  { label: "Client failure", value: byClass.clientFailure, color: "#f59e0b" },
                  { label: "Network", value: byClass.network, color: "#64748b" },
                ].filter((s) => s.value > 0)}
              />
            )}
          </div>
        </Panel>
        <Panel className="lg:col-span-2">
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Problem priority
          </div>
          <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <PriorityCount label="Critical" icon="🔴" count={data.priority.critical ?? 0} />
            <PriorityCount label="High" icon="🟠" count={data.priority.high ?? 0} />
            <PriorityCount label="Medium" icon="🟡" count={data.priority.medium ?? 0} />
            <PriorityCount label="Low" icon="⚪" count={data.priority.low ?? 0} />
          </div>
          <div className="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <p className="mb-2 text-xs font-medium text-zinc-500">Filter by class</p>
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={clsx(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    filter === f.id
                      ? "bg-indigo-600 text-white"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                  )}
                >
                  {f.label}
                  {f.id !== "all" && (
                    <span className="ml-1 opacity-80">
                      (
                      {f.id === "server_error"
                        ? byClass.serverError
                        : f.id === "client_failure"
                          ? byClass.clientFailure
                          : byClass.network}
                      )
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <Panel>
            <EmptyState
              title="No problems in this class"
              body="Try another filter, or wait for failed / network API calls."
            />
          </Panel>
        ) : (
          filtered.map((p) => (
            <Panel key={problemKey(p) + (p.resultClass ?? "")}>
              <div className="space-y-4 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={p.severity} />
                  <ResultClassBadge resultClass={p.resultClass as HttpResultClass | undefined} />
                  {p.statusCode != null && (
                    <span className="text-xs tabular-nums text-zinc-500">HTTP {p.statusCode}</span>
                  )}
                </div>
                <p className="font-mono text-sm font-semibold">
                  {p.method} {p.path}
                </p>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <span>{p.occurrences} errors</span>
                  <span>{p.usersAffected} users</span>
                  <span>{p.sessionsAffected} sessions</span>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <span>Error rate {(p.errorRate * 100).toFixed(1)}%</span>
                  <span>Avg latency {formatLatency(p.avgLatencyMs)}</span>
                </div>
                <ImpactBar score={p.impact.score} label={p.impact.label} />
                <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500">
                  <span>
                    First seen {new Date(p.firstSeen).toLocaleDateString()} · Last seen{" "}
                    {relativeTime(p.lastSeen)}
                  </span>
                  <Link className="btn-primary" to={`${base}/problems/${problemKey(p)}`}>
                    Investigate →
                  </Link>
                </div>
              </div>
            </Panel>
          ))
        )}
      </div>

      {data.slow.length > 0 && (
        <Panel className="mt-8">
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Slow responses
          </div>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.slow.map((e, i) => (
              <li key={`${e.method}-${e.path}-${i}`} className="px-5 py-4">
                <p className="font-medium">
                  🟡 {e.method} {e.path}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Average {e.avgLatencyMs}ms · P95 {e.p95Ms}ms · Last seen {relativeTime(e.lastSeen)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function PriorityCount({ label, icon, count }: { label: string; icon: string; count: number }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/80 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className="text-xs text-zinc-500">
        {icon} {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{count}</p>
    </div>
  );
}
