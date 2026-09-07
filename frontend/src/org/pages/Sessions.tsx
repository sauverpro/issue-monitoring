import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta } from "@/org/lib/metrics";
import type { SessionListItem } from "@/org/types";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";

type DashboardKpis = {
  kpis: { sessions: number; users: number; sessionsDelta: number | null; usersDelta: number | null };
};

export function SessionsPage() {
  const { orgId, projectId } = useParams();
  const { range } = useRange();
  const [items, setItems] = useState<SessionListItem[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<DashboardKpis["kpis"] | null>(null);

  async function load(filter?: string) {
    if (!projectId) return;
    const q = new URLSearchParams(range.query);
    if (filter) q.set("email", filter);
    setItems(
      await apiFetch<SessionListItem[]>(`/console/projects/${projectId}/sessions?${q.toString()}`)
    );
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, range.query]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<DashboardKpis>(`/console/projects/${projectId}/dashboard?${range.query}`)
      .then((d) => setKpis(d.kpis))
      .catch(() => undefined);
  }, [projectId, range.query]);

  return (
    <div>
      <PageHeader
        eyebrow="Project"
        title="Sessions"
        description="Raw session list for the selected date range."
      />
      {kpis && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <StatCard label="Sessions" value={kpis.sessions.toLocaleString()} hint={<Delta value={kpis.sessionsDelta} />} />
          <StatCard label="Users" value={kpis.users.toLocaleString()} hint={<Delta value={kpis.usersDelta} />} />
        </div>
      )}
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(email);
        }}
      >
        <input
          className="input max-w-xs"
          placeholder="Filter by email or user id"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-secondary">Search</button>
      </form>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <Panel>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-5 py-2">Session</th>
              <th className="px-5 py-2">User</th>
              <th className="px-5 py-2">Actions</th>
              <th className="px-5 py-2">Failures</th>
              <th className="px-5 py-2">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.sessionId} className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40">
                <td className="px-5 py-3 font-mono text-xs">
                  <Link
                    className="text-indigo-600 hover:underline dark:text-indigo-400"
                    to={`/orgs/${orgId}/projects/${projectId}/sessions/${encodeURIComponent(s.sessionId)}`}
                  >
                    {s.sessionId.slice(0, 12)}…
                  </Link>
                </td>
                <td className="px-5 py-3">
                  {s.userEmail || s.userId ? (
                    <Link
                      className="text-indigo-600 hover:underline dark:text-indigo-400"
                      to={`/orgs/${orgId}/projects/${projectId}/users/${encodeURIComponent(s.userId || s.userEmail || "")}`}
                    >
                      {s.userEmail ?? s.userId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-3 tabular-nums">{s.totalActions}</td>
                <td className="px-5 py-3 tabular-nums">{s.failures}</td>
                <td className="px-5 py-3 text-zinc-500">{new Date(s.lastActivity).toLocaleString()}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No sessions yet" body="Send ingest events with session.user_id or email, plus screens, clicks, and APIs." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
