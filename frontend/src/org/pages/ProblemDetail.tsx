import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { encodeUserKey, formatLatency, relativeTime } from "@/org/lib/journey";
import type { ProblemRow } from "@/org/types";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { ImpactBar, SeverityBadge } from "@/org/components/monitor";
import { LineChart, Sparkline } from "@/org/components/charts";
import { EmptyState, PageHeader, Panel } from "@/org/components/ui";

type Detail = ProblemRow & {
  trend: { date: string; count: number }[];
  users: {
    userKey: string;
    userId: string | null;
    email: string | null;
    errors: number;
    sessions: number;
    lastSeen: string;
  }[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
};

export function ProblemDetailPage() {
  const { orgId, projectId, problemKey: key } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !key) return;
    apiFetch<Detail>(`/console/projects/${projectId}/problems/${key}?${range.query}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, key, range.query]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const base = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <div>
      <Link to={`${base}/problems`} className="mb-3 inline-block text-sm text-indigo-600 dark:text-indigo-400">
        ← Errors
      </Link>
      <PageHeader
        title={`${data.method} ${data.path}`}
        actions={<TimeRangePicker />}
      />
      <div className="mb-6">
        <SeverityBadge severity={data.severity} />
        <p className="mt-3 text-sm text-zinc-500">
          {data.occurrences} occurrences · {data.usersAffected} users affected · {data.sessionsAffected}{" "}
          sessions affected
        </p>
      </div>

      <Panel className="mb-6">
        <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
          Error trend
        </div>
        <div className="p-4">
          {data.trend.length < 2 ? (
            <Sparkline values={data.trend.map((t) => t.count)} color="#ef4444" className="h-16" />
          ) : (
            <LineChart
              labels={data.trend.map((t) => t.date.slice(5))}
              series={[{ name: "Errors", color: "#ef4444", values: data.trend.map((t) => t.count) }]}
            />
          )}
        </div>
      </Panel>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            HTTP
          </div>
          <dl className="space-y-2 p-5 text-sm">
            <Row label="Method" value={data.method} />
            <Row label="Status" value={String(data.statusCode ?? data.failureReason ?? "—")} />
            <Row label="Endpoint" value={data.path} mono />
          </dl>
        </Panel>
        <Panel>
          <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            Performance
          </div>
          <dl className="space-y-2 p-5 text-sm">
            <Row label="Average" value={formatLatency(data.avgLatencyMs)} />
            <Row label="P50" value={formatLatency(data.p50Ms)} />
            <Row label="P95" value={formatLatency(data.p95Ms)} />
            <Row label="P99" value={formatLatency(data.p99Ms)} />
          </dl>
          <div className="px-5 pb-5">
            <ImpactBar score={data.impact.score} label={data.impact.label} />
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <span className="text-sm font-medium">Affected users</span>
          <Link className="text-xs text-indigo-600 dark:text-indigo-400" to={`${base}/problems/${key}/users`}>
            View all →
          </Link>
        </div>
        {data.users.length === 0 ? (
          <EmptyState title="No identified users" body="Users will appear when ingest includes user_id or email." />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-5 py-2">User</th>
                <th className="px-5 py-2">Errors</th>
                <th className="px-5 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => {
                const userKeyVal = encodeUserKey(u.userId, u.email ?? u.userKey);
                return (
                  <tr key={u.userKey} className="border-b border-zinc-100 dark:border-zinc-800">
                    <td className="px-5 py-3">
                      <Link className="text-indigo-600 hover:underline dark:text-indigo-400" to={`${base}/users/${userKeyVal}`}>
                        {u.email || u.userId || u.userKey}
                      </Link>
                    </td>
                    <td className="px-5 py-3 tabular-nums">{u.errors}</td>
                    <td className="px-5 py-3 text-zinc-500">
                      {new Date(u.lastSeen).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "font-medium"}>{value}</dd>
    </div>
  );
}

export function ProblemUsersPage() {
  const { orgId, projectId, problemKey: key } = useParams();
  const { range } = useRange();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<Detail["users"]>([]);
  const [meta, setMeta] = useState<{ method: string; path: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !key) return;
    const q = new URLSearchParams(range.query);
    if (search.trim()) q.set("search", search.trim());
    Promise.all([
      apiFetch<Detail>(`/console/projects/${projectId}/problems/${key}?${range.query}`),
      apiFetch<{ users: Detail["users"] }>(`/console/projects/${projectId}/problems/${key}/users?${q}`),
    ])
      .then(([detail, list]) => {
        setMeta({ method: detail.method, path: detail.path });
        setUsers(list.users);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, key, range.query, search]);

  const base = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <div>
      <Link to={`${base}/problems/${key}`} className="mb-3 inline-block text-sm text-indigo-600 dark:text-indigo-400">
        ← Error detail
      </Link>
      <PageHeader
        title="Users affected by this problem"
        description={meta ? `${meta.method} ${meta.path}` : undefined}
        actions={<TimeRangePicker />}
      />
      <input
        className="input mb-4 max-w-md"
        placeholder="Search user…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {error && <p className="text-red-600">{error}</p>}
      <Panel>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-5 py-2">User</th>
              <th className="px-5 py-2">Errors</th>
              <th className="px-5 py-2">Sessions</th>
              <th className="px-5 py-2">Last affected</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const userKeyVal = encodeUserKey(u.userId, u.email ?? u.userKey);
              return (
                <tr key={u.userKey} className="border-b border-zinc-100 dark:border-zinc-800">
                  <td className="px-5 py-3">
                    <Link className="text-indigo-600 hover:underline dark:text-indigo-400" to={`${base}/users/${userKeyVal}`}>
                      {u.email || u.userId || u.userKey}
                    </Link>
                  </td>
                  <td className="px-5 py-3 tabular-nums">{u.errors}</td>
                  <td className="px-5 py-3 tabular-nums">{u.sessions}</td>
                  <td className="px-5 py-3 text-zinc-500">{relativeTime(u.lastSeen)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}