import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { clsx } from "clsx";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Globe,
  Search,
  ShieldAlert,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { problemKey } from "@/org/lib/metrics";
import type { HttpResultClass } from "@/org/types";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { ResultClassBadge, SeverityBadge } from "@/org/components/monitor";
import { EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { encodeUserKey, formatLatency, relativeTime } from "@/org/lib/journey";

type StatusFilter = "all" | "success" | "client_failure" | "server_error" | "network" | "status0";

type EndpointUser = {
  userKey: string;
  userId: string | null;
  email: string | null;
  requests: number;
  sessions: number;
  lastSeen: string;
  sampleSessionId: string | null;
};

type EndpointRow = {
  method: string;
  path: string;
  statusCode: number | null;
  resultClass: HttpResultClass;
  service: string;
  serviceGroup: string;
  isStatus0: boolean;
  occurrences: number;
  usersAffected: number;
  sessionsAffected: number;
  firstSeen: string;
  lastSeen: string;
  avgLatencyMs: number;
  share: number;
  severity: "critical" | "high" | "medium" | "low";
  users: EndpointUser[];
};

type StatusTotals = {
  success: number;
  clientFailure: number;
  serverError: number;
  network: number;
  total: number;
  status0: number;
  status0Users: number;
  usersTotal: number;
  usersByClass: {
    success: number;
    clientFailure: number;
    serverError: number;
    network: number;
  };
};

type ServiceStat = StatusTotals & {
  service: string;
  users: number;
};

type Explorer = {
  summary: StatusTotals & { failureUsers: number };
  services: { id: string; label: string; count: number; users: number }[];
  serviceStats: Record<string, ServiceStat>;
  endpoints: EndpointRow[];
};

type AffectedUser = {
  userKey: string;
  userId: string | null;
  email: string | null;
  errors: number;
  requests?: number;
  sessions: number;
  lastSeen: string;
  sampleSessionId?: string | null;
  topEndpoint?: string | null;
};

const STATUS_FILTERS: {
  id: StatusFilter;
  label: string;
  hint: string;
  icon: typeof CheckCircle2;
  tone: string;
}[] = [
  {
    id: "all",
    label: "All",
    hint: "Every status",
    icon: Globe,
    tone: "border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/60",
  },
  {
    id: "success",
    label: "Success",
    hint: "2xx / 3xx / status 0 + SUCCESS",
    icon: CheckCircle2,
    tone: "border-emerald-400/60 bg-emerald-50 dark:border-emerald-500/40 dark:bg-emerald-500/10",
  },
  {
    id: "client_failure",
    label: "Client failure",
    hint: "4xx · status 0 + FAILURE",
    icon: ShieldAlert,
    tone: "border-amber-400/60 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10",
  },
  {
    id: "server_error",
    label: "Server error",
    hint: "HTTP 5xx",
    icon: AlertTriangle,
    tone: "border-red-400/60 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10",
  },
  {
    id: "network",
    label: "Network",
    hint: "Status 0 without outcome",
    icon: WifiOff,
    tone: "border-slate-400/60 bg-slate-50 dark:border-slate-500/40 dark:bg-slate-500/10",
  },
  {
    id: "status0",
    label: "HTTP 0",
    hint: "All status-0 failures",
    icon: WifiOff,
    tone: "border-orange-400/60 bg-orange-50 dark:border-orange-500/40 dark:bg-orange-500/10",
  },
];

function endpointId(e: EndpointRow) {
  return `${e.service}|${e.method}|${e.path}|${e.statusCode ?? ""}|${e.resultClass}`;
}

function countForFilter(s: StatusTotals, id: StatusFilter): number {
  if (id === "all") return s.total;
  if (id === "success") return s.success;
  if (id === "client_failure") return s.clientFailure;
  if (id === "server_error") return s.serverError;
  if (id === "network") return s.network;
  return s.status0;
}

function usersForFilter(s: StatusTotals, id: StatusFilter): number {
  if (id === "all") return s.usersTotal;
  if (id === "success") return s.usersByClass.success;
  if (id === "client_failure") return s.usersByClass.clientFailure;
  if (id === "server_error") return s.usersByClass.serverError;
  if (id === "network") return s.usersByClass.network;
  return s.status0Users;
}

function userLabel(u: { email: string | null; userId: string | null; userKey: string }) {
  return u.email || u.userId || u.userKey || "Anonymous";
}

export function ProblemsPage() {
  const { orgId, projectId } = useParams();
  const { range } = useRange();
  const [data, setData] = useState<Explorer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [apiFilter, setApiFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [users, setUsers] = useState<AffectedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setData(await apiFetch<Explorer>(`/console/projects/${projectId}/api-status?${range.query}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [projectId, range.query]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeStats: StatusTotals = useMemo(() => {
    if (!data) {
      return {
        success: 0,
        clientFailure: 0,
        serverError: 0,
        network: 0,
        total: 0,
        status0: 0,
        status0Users: 0,
        usersTotal: 0,
        usersByClass: { success: 0, clientFailure: 0, serverError: 0, network: 0 },
      };
    }
    if (apiFilter === "all") return data.summary;
    const ss = data.serviceStats?.[apiFilter];
    if (!ss) {
      return {
        success: 0,
        clientFailure: 0,
        serverError: 0,
        network: 0,
        total: 0,
        status0: 0,
        status0Users: 0,
        usersTotal: 0,
        usersByClass: { success: 0, clientFailure: 0, serverError: 0, network: 0 },
      };
    }
    return {
      success: ss.success,
      clientFailure: ss.clientFailure,
      serverError: ss.serverError,
      network: ss.network,
      total: ss.total,
      status0: ss.status0,
      status0Users: ss.status0Users,
      usersTotal: ss.users,
      usersByClass: ss.usersByClass,
    };
  }, [data, apiFilter]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.endpoints.filter((e) => {
      if (apiFilter !== "all" && e.service !== apiFilter) return false;
      if (filter === "success" && e.resultClass !== "success") return false;
      if (filter === "client_failure" && e.resultClass !== "client_failure") return false;
      if (filter === "server_error" && e.resultClass !== "server_error") return false;
      if (filter === "network" && e.resultClass !== "network") return false;
      if (filter === "status0" && !(e.isStatus0 && e.resultClass !== "success")) return false;
      if (!q) return true;
      return (
        e.path.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        e.service.toLowerCase().includes(q) ||
        String(e.statusCode ?? "").includes(q) ||
        e.resultClass.includes(q) ||
        e.users.some((u) => userLabel(u).toLowerCase().includes(q))
      );
    });
  }, [data, filter, apiFilter, search]);

  const selected = useMemo(
    () => filtered.find((e) => endpointId(e) === selectedId) ?? null,
    [filtered, selectedId]
  );

  useEffect(() => {
    if (selectedId && !filtered.some((e) => endpointId(e) === selectedId)) {
      setSelectedId(null);
    }
  }, [filtered, selectedId]);

  const loadUsers = useCallback(async () => {
    if (!projectId || !data) return;
    setUsersLoading(true);
    try {
      const params = new URLSearchParams(range.query);
      if (userSearch.trim()) params.set("search", userSearch.trim());
      if (apiFilter !== "all") params.set("service", apiFilter);

      if (selected) {
        params.set("method", selected.method);
        params.set("path", selected.path);
        params.set("statusCode", selected.statusCode == null ? "" : String(selected.statusCode));
        params.set("resultClass", selected.resultClass);
        params.set("includeSuccess", "1");
        if (selected.service) params.set("service", selected.service);
      } else if (filter === "status0") {
        params.set("status0", "1");
      } else if (
        filter === "client_failure" ||
        filter === "server_error" ||
        filter === "network" ||
        filter === "success"
      ) {
        params.set("resultClass", filter);
        if (filter === "success") params.set("includeSuccess", "1");
      }
      const res = await apiFetch<{ users: AffectedUser[] }>(
        `/console/projects/${projectId}/api-status/users?${params}`
      );
      setUsers(res.users);
    } catch {
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, [projectId, data, filter, apiFilter, selected, range.query, userSearch]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const base = `/orgs/${orgId}/projects/${projectId}`;
  const s = activeStats;

  const apiFilters: { id: string; label: string; count: number; users: number }[] = [
    {
      id: "all",
      label: "All APIs",
      count: data.summary.total,
      users: data.summary.usersTotal,
    },
    ...(data.services ?? []).map((svc) => ({
      id: svc.id,
      label: svc.label,
      count: svc.count,
      users: svc.users,
    })),
  ];

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="API requests"
        description="Pick an API to scope status totals and users, then drill into endpoints."
        actions={<TimeRangePicker />}
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={apiFilter === "all" ? "Total requests" : `${apiFilter} requests`}
          value={s.total.toLocaleString()}
          hint={`${s.usersTotal.toLocaleString()} users`}
        />
        <StatCard
          label="Success"
          value={s.success.toLocaleString()}
          hint={`${s.usersByClass.success.toLocaleString()} users`}
        />
        <StatCard
          label="Client failures"
          value={s.clientFailure.toLocaleString()}
          hint={`${s.usersByClass.clientFailure.toLocaleString()} users`}
        />
        <StatCard
          label="Server errors"
          value={s.serverError.toLocaleString()}
          hint={`${s.usersByClass.serverError.toLocaleString()} users`}
        />
        <StatCard
          label="HTTP 0 failures"
          value={s.status0.toLocaleString()}
          hint={`${s.status0Users.toLocaleString()} users`}
        />
      </div>

      <div className="mb-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">API</p>
        <div className="flex flex-wrap gap-2">
          {apiFilters.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setApiFilter(a.id);
                setSelectedId(null);
              }}
              className={clsx(
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition",
                apiFilter === a.id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              )}
            >
              {a.label}
              <span className="ml-1.5 tabular-nums opacity-80">{a.count.toLocaleString()}</span>
              <span className="ml-1 text-[10px] opacity-70">· {a.users} users</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          Status{apiFilter !== "all" ? ` · ${apiFilter}` : ""}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {STATUS_FILTERS.map((f) => {
            const Icon = f.icon;
            const active = filter === f.id;
            const reqs = countForFilter(s, f.id);
            const userN = usersForFilter(s, f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFilter(f.id);
                  setSelectedId(null);
                }}
                className={clsx(
                  "rounded-2xl border px-3 py-3 text-left transition",
                  active
                    ? `${f.tone} ring-2 ring-indigo-500/40`
                    : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/50"
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <Icon className="h-4 w-4 text-zinc-500" />
                  <span className="text-sm font-semibold tabular-nums">{reqs.toLocaleString()}</span>
                </span>
                <span className="mt-2 block text-sm font-medium">{f.label}</span>
                <span className="mt-0.5 block text-[11px] text-zinc-500">
                  {userN.toLocaleString()} user{userN === 1 ? "" : "s"}
                </span>
                <span className="mt-0.5 block text-[10px] text-zinc-400">{f.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className="input w-full pl-9"
            placeholder="Search method, path, API, or user…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <p className="text-xs text-zinc-500">
          {filtered.length} endpoint{filtered.length === 1 ? "" : "s"}
          {selected ? " · 1 selected" : ""}
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)]">
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <Panel>
              <EmptyState
                title="No matching requests"
                body="Try another API or status filter, or clear the search."
              />
            </Panel>
          ) : (
            filtered.map((e) => {
              const id = endpointId(e);
              const active = selectedId === id;
              const isFailure = e.resultClass !== "success";
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedId(active ? null : id)}
                  className={clsx(
                    "w-full rounded-2xl border p-4 text-left transition",
                    active
                      ? "border-indigo-500 bg-indigo-50/80 ring-1 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-500/10"
                      : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {e.service}
                    </span>
                    {isFailure && <SeverityBadge severity={e.severity} />}
                    <ResultClassBadge resultClass={e.resultClass} />
                    <span className="text-xs tabular-nums text-zinc-500">
                      HTTP {e.statusCode ?? 0}
                    </span>
                    {e.isStatus0 && e.resultClass !== "success" && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800 dark:bg-orange-500/20 dark:text-orange-300">
                        Status 0
                      </span>
                    )}
                  </div>
                  <p className="mt-2 font-mono text-sm font-semibold">
                    {e.method} {e.path}
                  </p>
                  <div className="mt-3 grid gap-2 text-xs text-zinc-600 dark:text-zinc-400 sm:grid-cols-4">
                    <span>
                      <strong className="tabular-nums text-zinc-900 dark:text-zinc-100">
                        {e.occurrences.toLocaleString()}
                      </strong>{" "}
                      {isFailure ? "errors" : "calls"}
                    </span>
                    <span>
                      <strong className="tabular-nums text-zinc-900 dark:text-zinc-100">
                        {e.usersAffected}
                      </strong>{" "}
                      users
                    </span>
                    <span>
                      <strong className="tabular-nums text-zinc-900 dark:text-zinc-100">
                        {e.sessionsAffected}
                      </strong>{" "}
                      sessions
                    </span>
                    <span>Avg {formatLatency(e.avgLatencyMs)}</span>
                  </div>

                  {/* Users who requested this endpoint */}
                  <div className="mt-3 rounded-xl border border-zinc-100 bg-zinc-50/80 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/40">
                    <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      <Users className="h-3 w-3" />
                      Users on this endpoint
                    </p>
                    {e.users.length === 0 ? (
                      <p className="text-xs text-zinc-500">No identified users</p>
                    ) : (
                      <ul className="space-y-1">
                        {e.users.slice(0, 5).map((u) => {
                          const key = encodeUserKey(u.userId, u.email ?? u.userKey);
                          return (
                            <li key={u.userKey} className="flex items-center justify-between gap-2 text-xs">
                              <Link
                                to={`${base}/users/${key}`}
                                className="min-w-0 truncate font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                {userLabel(u)}
                              </Link>
                              <span className="shrink-0 tabular-nums text-zinc-500">
                                {u.requests}× · {relativeTime(u.lastSeen)}
                              </span>
                            </li>
                          );
                        })}
                        {e.usersAffected > e.users.length && (
                          <li className="text-[11px] text-zinc-400">
                            +{e.usersAffected - e.users.length} more — select card for full list
                          </li>
                        )}
                      </ul>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500">
                    <span>
                      First {new Date(e.firstSeen).toLocaleDateString()} · Last{" "}
                      {relativeTime(e.lastSeen)}
                    </span>
                    {isFailure ? (
                      <Link
                        to={`${base}/problems/${problemKey(e)}`}
                        className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        Investigate
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">Healthy</span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <Panel>
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-zinc-500" />
                <div>
                  <p className="text-sm font-medium">
                    {selected ? "Endpoint users" : "Users in filter"}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    {selected
                      ? `${selected.service} · ${selected.method} ${selected.path}`
                      : [
                          apiFilter === "all" ? null : apiFilter,
                          filter === "all" ? "all statuses" : STATUS_FILTERS.find((f) => f.id === filter)?.label,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                  </p>
                </div>
              </div>
              {selected && (
                <button
                  type="button"
                  className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Clear selection"
                  onClick={() => setSelectedId(null)}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
              <input
                className="input w-full text-sm"
                placeholder="Search email or user id…"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
              />
            </div>
            {usersLoading ? (
              <p className="px-4 py-8 text-center text-sm text-zinc-500">Loading users…</p>
            ) : users.length === 0 ? (
              <EmptyState
                title="No users in this filter"
                body="Try another API or status, clear search, or pick a different endpoint."
              />
            ) : (
              <ul className="max-h-[36rem] divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
                {users.map((u) => {
                  const key = encodeUserKey(u.userId, u.email ?? u.userKey);
                  const n = u.requests ?? u.errors;
                  return (
                    <li key={u.userKey} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            className="truncate text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                            to={`${base}/users/${key}`}
                          >
                            {userLabel(u)}
                          </Link>
                          {u.topEndpoint && !selected && (
                            <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-500">
                              {u.topEndpoint}
                            </p>
                          )}
                          <p className="mt-1 text-[11px] text-zinc-500">
                            {n} request{n === 1 ? "" : "s"} · {u.sessions} session
                            {u.sessions === 1 ? "" : "s"} · {relativeTime(u.lastSeen)}
                          </p>
                        </div>
                        {u.sampleSessionId && (
                          <Link
                            className="shrink-0 text-[11px] font-medium text-zinc-500 hover:text-indigo-600"
                            to={`${base}/sessions/${encodeURIComponent(u.sampleSessionId)}`}
                          >
                            Session
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
