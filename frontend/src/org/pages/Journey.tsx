import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { UserRound } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { dayBounds, encodeUserKey, formatDuration, localISODate, relativeTime } from "@/org/lib/journey";
import type { JourneyUser } from "@/org/types";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";

type Home = {
  stats: { activeUsers: number; sessions: number; apiErrors: number; avgLatencyMs: number };
  users: JourneyUser[];
};

export function JourneyPage() {
  const { orgId, projectId } = useParams();
  const [date, setDate] = useState(localISODate());
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(d = date, q = search) {
    if (!projectId) return;
    const { from, to } = dayBounds(d);
    const home = await apiFetch<Home>(
      `/console/projects/${projectId}/journey?${new URLSearchParams({ from, to })}`
    );
    const term = q.trim();
    if (!term) {
      setData(home);
      return;
    }
    const matches = await apiFetch<JourneyUser[]>(
      `/console/projects/${projectId}/users?${new URLSearchParams({ search: term, days: "30" })}`
    );
    setData({ ...home, users: matches });
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    }, 150);
    return () => window.clearTimeout(t);
  }, [projectId, date, search]);

  function onFilter(e: FormEvent) {
    e.preventDefault();
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="User Journey"
        description="Search a person, open a day, pick a session, then inspect the failing request."
      />
      <form onSubmit={onFilter} className="mb-6 flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-zinc-500">
          Search user
          <input
            className="input mt-1 w-72"
            placeholder='Search “Jean”…'
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Date
          <input
            className="input mt-1 w-44"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
      </form>
      {!search.trim() && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active users" value={data.stats.activeUsers.toLocaleString()} />
          <StatCard label="Sessions" value={data.stats.sessions.toLocaleString()} />
          <StatCard label="API errors" value={data.stats.apiErrors.toLocaleString()} />
          <StatCard label="Avg latency" value={`${data.stats.avgLatencyMs}ms`} />
        </div>
      )}
      <Panel>
        <div className="border-b border-zinc-200 px-5 py-3 text-[11px] font-semibold uppercase tracking-widest text-zinc-400 dark:border-zinc-800">
          {search.trim() ? "Matching users" : "User journeys"}
        </div>
        {data.users.length === 0 ? (
          <EmptyState
            title={search.trim() ? "No matching users" : "No identified users this day"}
            body="Identify users on ingest (user_id or email), then search by name, email, or id."
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {data.users.map((u) => {
              const key = encodeUserKey(u.userId, u.email ?? u.userKey);
              return (
                <li key={u.userKey}>
                  <Link
                    to={`/orgs/${orgId}/projects/${projectId}/users/${key}${search.trim() ? "" : `?date=${date}`}`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                      <UserRound className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{u.email || `User ${u.userId}`}</p>
                      <p className="text-xs text-zinc-500">
                        {relativeTime(u.lastActive)} · {u.actions} actions · {formatDuration(u.durationMs)}
                      </p>
                    </div>
                    {u.errors > 0 && (
                      <span className="text-xs font-medium text-red-600">🔴 {u.errors} errors</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
