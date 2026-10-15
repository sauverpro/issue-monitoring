import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { UserRound } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { Delta } from "@/org/lib/metrics";
import { encodeUserKey, relativeTime } from "@/org/lib/journey";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { ApiClassSummary } from "@/org/components/monitor";
import type { JourneyUser } from "@/org/types";

type DashboardKpis = {
  kpis: { users: number; sessions: number; usersDelta: number | null; sessionsDelta: number | null };
};

type Coverage = {
  identified: number;
  anonymousSessions: number;
  totalSessions: number;
  firstSeen: string | null;
  lastSeen: string | null;
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "errors", label: "Errors" },
] as const;

const PAGE_SIZE = 80;

export function UsersPage() {
  const { orgId, projectId } = useParams();
  const { range } = useRange();
  const [items, setItems] = useState<JourneyUser[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [error, setError] = useState<string | null>(null);
  const [kpis, setKpis] = useState<DashboardKpis["kpis"] | null>(null);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function load(q = search, f = filter) {
    if (!projectId) return;
    const params = new URLSearchParams(range.query);
    if (q.trim()) params.set("search", q.trim());
    if (f !== "all") params.set("filter", f);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", "0");
    const [users, cov] = await Promise.all([
      apiFetch<JourneyUser[]>(`/console/projects/${projectId}/users?${params}`),
      apiFetch<Coverage>(`/console/projects/${projectId}/users/coverage?${range.query}`).catch(
        () => null
      ),
    ]);
    setItems(users);
    if (cov) setCoverage(cov);
  }

  async function loadMore() {
    if (!projectId || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(range.query);
      if (search.trim()) params.set("search", search.trim());
      if (filter !== "all") params.set("filter", filter);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(items.length));
      const next = await apiFetch<JourneyUser[]>(`/console/projects/${projectId}/users?${params}`);
      setItems((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoadingMore(false);
    }
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

  const identified = coverage?.identified ?? kpis?.users ?? items.length;
  const hasMore = items.length < identified && filter !== "errors";
  const anonPct =
    coverage && coverage.totalSessions > 0
      ? Math.round((coverage.anonymousSessions / coverage.totalSessions) * 100)
      : 0;

  return (
    <div>
      <PageHeader
        eyebrow="Users"
        title="Users"
        description="Only people whose app session sent user_id or email. Registered marketplace accounts that never opened the instrumented app are not here."
        actions={<TimeRangePicker />}
      />
      {kpis && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Identified users"
            value={identified.toLocaleString()}
            hint={<Delta value={kpis.usersDelta} />}
          />
          <StatCard
            label="Sessions"
            value={(coverage?.totalSessions ?? kpis.sessions).toLocaleString()}
            hint={<Delta value={kpis.sessionsDelta} />}
          />
          <StatCard
            label="Anonymous sessions"
            value={(coverage?.anonymousSessions ?? 0).toLocaleString()}
            hint={coverage ? `${anonPct}% of sessions had no identity` : undefined}
          />
          <StatCard
            label="Last ingest"
            value={
              coverage?.lastSeen
                ? new Date(coverage.lastSeen).toLocaleDateString()
                : "—"
            }
            hint={
              coverage?.lastSeen ? relativeTime(coverage.lastSeen) : "No sessions in this range"
            }
          />
        </div>
      )}

      {coverage && coverage.anonymousSessions > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {coverage.anonymousSessions.toLocaleString()} session
          {coverage.anonymousSessions === 1 ? "" : "s"} in this range never sent{" "}
          <code className="text-xs">setUser</code> (user_id / email). Those people do not appear
          in this list. Call <code className="text-xs">Monitor.setUser(&#123; id, email &#125;)</code>{" "}
          after login on every app start.
        </div>
      )}
      {coverage && coverage.totalSessions === 0 && (
        <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          No ingest in this date range. Widen the range, or check that the production app is still
          posting to this monitor (public ingest URL + live API key).
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
      <p className="mb-2 text-xs text-zinc-500">
        Showing {items.length.toLocaleString()}
        {filter === "all" && identified > 0 ? ` of ${identified.toLocaleString()} identified` : ""}{" "}
        in {range.label}
      </p>
      <Panel>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-5 py-2">User</th>
              <th className="px-5 py-2">Last active</th>
              <th className="px-5 py-2">Sessions</th>
              <th className="px-5 py-2">Actions</th>
              <th className="px-5 py-2">Outcomes</th>
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
                  <td className="px-5 py-3">
                    <ApiClassSummary outcomes={u.apiOutcomes} fallback={u.errors} />
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={5}>
                  <EmptyState
                    title="No identified users in this range"
                    body="This is not the marketplace user table. Only sessions that sent user_id or email appear here."
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {hasMore && (
          <div className="border-t border-zinc-100 p-4 text-center dark:border-zinc-800">
            <button type="button" className="btn-secondary" disabled={loadingMore} onClick={() => void loadMore()}>
              {loadingMore ? "Loading…" : `Load more (${identified - items.length} remaining)`}
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}
