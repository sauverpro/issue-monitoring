import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { UserRound } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta } from "@/org/lib/metrics";
import { encodeUserKey, relativeTime } from "@/org/lib/journey";
import type { JourneyUser } from "@/org/types";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";

type DashboardKpis = {
  kpis: { users: number; sessions: number; usersDelta: number | null; sessionsDelta: number | null };
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "errors", label: "Errors" },
] as const;

export function UsersPage() {
  const { orgId, projectId } = useParams();
  const { range } = useRange();
  const [items, setItems] = useState<JourneyUser[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<DashboardKpis["kpis"] | null>(null);

  async function load(q = search, f = filter) {
    if (!projectId) return;
    const params = new URLSearchParams(range.query);
    if (q.trim()) params.set("search", q.trim());
    if (f !== "all") params.set("filter", f);
    setItems(await apiFetch<JourneyUser[]>(`/console/projects/${projectId}/users?${params}`));
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    }, 150);
    return () => window.clearTimeout(t);
  }, [projectId, filter, search, range.query]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<DashboardKpis>(`/console/projects/${projectId}/dashboard?${range.query}`)
      .then((d) => setKpis(d.kpis))
      .catch(() => undefined);
  }, [projectId, range.query]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed"));
  }

  return (
    <div>
      <PageHeader
        eyebrow="Users"
        title="Users"
        description="Open a user to see their activity calendar and session timeline."
      />
      {kpis && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <StatCard label="Users" value={kpis.users.toLocaleString()} hint={<Delta value={kpis.usersDelta} />} />
          <StatCard label="Sessions" value={kpis.sessions.toLocaleString()} hint={<Delta value={kpis.sessionsDelta} />} />
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={onSearch} className="flex gap-2">
          <input
            className="input w-72"
            placeholder='Search “Jean”…'
            value={search}
            autoFocus
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn-secondary">Search</button>
        </form>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={filter === f.id ? "btn-primary" : "btn-secondary"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <Panel>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-5 py-2">User</th>
              <th className="px-5 py-2">Last active</th>
              <th className="px-5 py-2">Sessions</th>
              <th className="px-5 py-2">Actions</th>
              <th className="px-5 py-2">Errors</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const key = encodeUserKey(u.userId, u.email ?? u.userKey);
              return (
                <tr
                  key={u.userKey}
                  className="border-b border-zinc-100 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/40"
                >
                  <td className="px-5 py-3">
                    <Link
                      to={`/orgs/${orgId}/projects/${projectId}/users/${key}`}
                      className="flex items-center gap-3 font-medium text-zinc-900 hover:text-indigo-600 dark:text-zinc-100"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
                        <UserRound className="h-4 w-4" />
                      </span>
                      <span>
                        {u.email || `User ${u.userId}`}
                        {u.email && u.userId && (
                          <span className="block text-xs font-normal text-zinc-400">id {u.userId}</span>
                        )}
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-zinc-500">{relativeTime(u.lastActive)}</td>
                  <td className="px-5 py-3 tabular-nums">{u.sessions}</td>
                  <td className="px-5 py-3 tabular-nums">{u.actions}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {u.errors > 0 ? (
                      <span className="font-medium text-red-600">{u.errors} 🔴</span>
                    ) : (
                      0
                    )}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState title="No users yet" body="Identify users on ingest (user_id or email) to populate this list." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
