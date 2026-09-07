import { useEffect, useState, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta, problemKey } from "@/org/lib/metrics";
import type { ProblemRow } from "@/org/types";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { ImpactBar, SeverityBadge } from "@/org/components/monitor";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { formatLatency, relativeTime } from "@/org/lib/journey";

type ProblemsPayload = {
  summary: {
    totalErrors: number;
    totalErrorsDelta: number | null;
    usersAffected: number;
    usersAffectedDelta: number | null;
    errors5xx: number;
    errors5xxDelta: number | null;
    critical: number;
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

export function ProblemsPage() {
  const { orgId, projectId } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<ProblemsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const base = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="Errors"
        description="Which problems are hurting your users the most?"
        actions={<TimeRangePicker />}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total errors"
          value={data.summary.totalErrors.toLocaleString()}
          hint={<Delta value={data.summary.totalErrorsDelta} invert />}
        />
        <StatCard
          label="Users affected"
          value={data.summary.usersAffected.toLocaleString()}
          hint={<Delta value={data.summary.usersAffectedDelta} invert />}
        />
        <StatCard
          label="5xx errors"
          value={data.summary.errors5xx.toLocaleString()}
          hint={<Delta value={data.summary.errors5xxDelta} invert />}
        />
        <StatCard label="Critical" value={data.summary.critical} />
      </div>

      <Panel className="mb-6">
        <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
          Problem priority
        </div>
        <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
          <PriorityCount label="Critical" icon="🔴" count={data.priority.critical ?? 0} />
          <PriorityCount label="High" icon="🟠" count={data.priority.high ?? 0} />
          <PriorityCount label="Medium" icon="🟡" count={data.priority.medium ?? 0} />
          <PriorityCount label="Low" icon="⚪" count={data.priority.low ?? 0} />
        </div>
      </Panel>

      <div className="space-y-4">
        {data.errors.length === 0 ? (
          <Panel>
            <EmptyState title="No failures" body="Failed API calls will group here by method, path, and status." />
          </Panel>
        ) : (
          data.errors.map((p) => (
            <Panel key={problemKey(p)}>
              <div className="space-y-4 p-5">
                <SeverityBadge severity={p.severity} />
                <p className="font-mono text-sm font-semibold">
                  {p.method} {p.path}
                </p>
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <span>{p.occurrences} errors</span>
                  <span>{p.usersAffected} users</span>
                  <span>{p.sessionsAffected} sessions</span>
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  <span>
                    Error rate {(p.errorRate * 100).toFixed(1)}%
                  </span>
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
