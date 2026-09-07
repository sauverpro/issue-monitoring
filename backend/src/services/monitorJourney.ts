import type { Pool } from "pg";
import { fetchActionsForSessions } from "./monitorSessions.js";
import { isApiCall } from "./sessionSummary.js";
import type { SessionAction } from "../types/sessionInvestigation.js";

const USER_KEY_SQL = `COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''))`;

export type DateRange = { from: Date; to: Date };

export type TimelineFilters = {
  kind?: string;
  status?: string;
  method?: string;
  screen?: string;
  sessionId?: string;
  statusClass?: string;
  minLatency?: number;
};

export type JourneyUser = {
  userKey: string;
  userId: string | null;
  email: string | null;
  lastActive: string;
  sessions: number;
  actions: number;
  errors: number;
  durationMs: number;
};

export function parseDateRange(query: {
  date?: string;
  from?: string;
  to?: string;
  days?: number;
}): DateRange {
  if (query.date && /^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
    const from = new Date(`${query.date}T00:00:00.000Z`);
    const to = new Date(`${query.date}T23:59:59.999Z`);
    return { from, to };
  }
  if (query.from || query.to) {
    const from = query.from ? new Date(query.from) : new Date(0);
    const to = query.to ? new Date(query.to) : new Date();
    return { from, to };
  }
  const days = Math.min(Math.max(query.days ?? 1, 1), 90);
  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  from.setUTCHours(0, 0, 0, 0);
  return { from, to };
}

export function decodeUserKey(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function filterTimeline(
  actions: SessionAction[],
  filters: TimelineFilters
): SessionAction[] {
  return actions.filter((a) => {
    if (filters.sessionId && a.sessionId !== filters.sessionId) return false;
    if (filters.screen) {
      const hay = `${a.screen ?? ""} ${a.endpoint ?? ""}`.toLowerCase();
      if (!hay.includes(filters.screen.toLowerCase())) return false;
    }
    const kind = classifyKind(a);
    if (filters.kind && filters.kind !== "all" && kind !== filters.kind) return false;
    if (filters.status && filters.status !== "all") {
      const st = (a.status ?? "").toLowerCase();
      if (filters.status === "success" && st !== "success") return false;
      if (filters.status === "failure" && st !== "failure") return false;
    }
    if (filters.method && filters.method !== "all") {
      if ((a.method ?? "").toUpperCase() !== filters.method.toUpperCase()) return false;
    }
    if (filters.statusClass && filters.statusClass !== "all") {
      const code = parseInt(a.httpStatus ?? "", 10);
      if (Number.isNaN(code)) return false;
      const cls = `${Math.floor(code / 100)}xx`;
      if (cls !== filters.statusClass) return false;
    }
    if (filters.minLatency != null && filters.minLatency > 0) {
      if (a.latencyMs == null || a.latencyMs < filters.minLatency) return false;
    }
    return true;
  });
}

const INTERACTION_KINDS = new Set([
  "click",
  "form_start",
  "form_submit",
  "search",
  "filter",
  "modal_open",
  "modal_close",
  "download",
  "file_upload",
  "purchase_start",
  "purchase_complete",
]);

export function classifyKind(a: SessionAction): string {
  const t = (a.actionType ?? "").toLowerCase();
  if (t === "navigation" || t === "screen_view") return "screen";
  if (INTERACTION_KINDS.has(t)) return "action";
  if (t === "logout") return "session";
  if (t === "auth" || t === "lifecycle") {
    const msg = (a.message ?? "").toLowerCase();
    if (msg.includes("fail") || msg.includes("error")) return "error";
    return t === "auth" ? "session" : "lifecycle";
  }
  if (isApiCall(a)) return a.status === "failure" ? "api_failure" : "api";
  return t || "other";
}

export type JourneyMapNode = {
  screen: string;
  time: string;
  apiTotal: number;
  apiOk: number;
  apiFail: number;
  failed: boolean;
};

export function buildJourneyMap(actions: SessionAction[]): JourneyMapNode[] {
  const nodes: JourneyMapNode[] = [];
  let current: JourneyMapNode | null = null;
  let lastScreen: string | null = null;

  for (const a of actions) {
    const t = (a.actionType ?? "").toLowerCase();
    const screenName =
      t === "navigation"
        ? a.screen || a.endpoint || a.message || "Unknown"
        : a.screen;
    if (t === "navigation" && screenName && screenName !== lastScreen) {
      current = {
        screen: screenName,
        time: a.timestamp,
        apiTotal: 0,
        apiOk: 0,
        apiFail: 0,
        failed: false,
      };
      nodes.push(current);
      lastScreen = screenName;
      continue;
    }
    if (!current && screenName) {
      current = {
        screen: screenName,
        time: a.timestamp,
        apiTotal: 0,
        apiOk: 0,
        apiFail: 0,
        failed: false,
      };
      nodes.push(current);
      lastScreen = screenName;
    }
    if (isApiCall(a) && current) {
      current.apiTotal += 1;
      if (a.status === "failure") {
        current.apiFail += 1;
        current.failed = true;
      } else if (a.status === "success") {
        current.apiOk += 1;
      }
    }
  }
  return nodes;
}

export function groupActionsByDay(
  actions: SessionAction[]
): { date: string; actions: SessionAction[] }[] {
  const map = new Map<string, SessionAction[]>();
  for (const a of actions) {
    const day = a.timestamp.slice(0, 10);
    const list = map.get(day) ?? [];
    list.push(a);
    map.set(day, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, dayActions]) => ({
      date,
      actions: [...dayActions].sort((x, y) => {
        if (x.timestamp !== y.timestamp) return y.timestamp.localeCompare(x.timestamp);
        return y.actionIndex - x.actionIndex;
      }),
    }));
}

async function sessionIdsForUser(
  pool: Pool,
  projectId: string,
  ident: string,
  range?: DateRange
): Promise<string[]> {
  const params: unknown[] = [projectId, ident];
  let extra = "";
  if (range) {
    extra = ` AND ended_at >= $3 AND started_at <= $4`;
    params.push(range.from, range.to);
  }
  const q = await pool.query<{ session_id: string }>(
    `SELECT session_id FROM user_sessions
     WHERE project_id = $1 AND (user_id = $2 OR user_email = $2)${extra}
     ORDER BY ended_at DESC
     LIMIT 200`,
    params
  );
  return q.rows.map((r) => r.session_id);
}

export async function listProjectUsers(
  pool: Pool,
  projectId: string,
  opts: { search?: string; filter?: string; range?: DateRange; limit?: number }
): Promise<JourneyUser[]> {
  const limit = opts.limit ?? 80;
  const params: unknown[] = [projectId];
  let i = 2;
  const conds = [`project_id = $1`, `${USER_KEY_SQL} IS NOT NULL`];
  if (opts.range) {
    conds.push(`ended_at >= $${i++}`);
    params.push(opts.range.from);
    conds.push(`started_at <= $${i++}`);
    params.push(opts.range.to);
  }
  if (opts.search) {
    conds.push(`(user_id ILIKE $${i} OR user_email ILIKE $${i})`);
    params.push(`%${opts.search}%`);
    i++;
  }
  if (opts.filter === "active") {
    conds.push(`ended_at >= now() - interval '15 minutes'`);
  }
  params.push(limit);
  const having = opts.filter === "errors" ? `HAVING SUM(failure_events) > 0` : "";
  const q = await pool.query<{
    user_key: string;
    user_id: string | null;
    email: string | null;
    last_active: Date;
    sessions: string;
    actions: string;
    errors: string;
    duration_ms: string;
  }>(
    `SELECT ${USER_KEY_SQL} AS user_key,
            MAX(user_id) FILTER (WHERE user_id IS NOT NULL AND TRIM(user_id) <> '') AS user_id,
            MAX(user_email) FILTER (WHERE user_email IS NOT NULL AND TRIM(user_email) <> '') AS email,
            MAX(ended_at) AS last_active,
            COUNT(*)::text AS sessions,
            COALESCE(SUM(total_events), 0)::text AS actions,
            COALESCE(SUM(failure_events), 0)::text AS errors,
            COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000), 0)::text AS duration_ms
     FROM user_sessions
     WHERE ${conds.join(" AND ")}
     GROUP BY ${USER_KEY_SQL}
     ${having}
     ORDER BY last_active DESC
     LIMIT $${i}`,
    params
  );
  return q.rows.map((r) => ({
    userKey: r.user_key,
    userId: r.user_id,
    email: r.email,
    lastActive: r.last_active.toISOString(),
    sessions: Number(r.sessions),
    actions: Number(r.actions),
    errors: Number(r.errors),
    durationMs: Math.round(Number(r.duration_ms)),
  }));
}

export async function getUserProfile(
  pool: Pool,
  projectId: string,
  userKey: string
): Promise<JourneyUser | null> {
  const ident = decodeUserKey(userKey);
  const q = await pool.query<{
    user_key: string;
    user_id: string | null;
    email: string | null;
    last_active: Date;
    sessions: string;
    actions: string;
    errors: string;
    duration_ms: string;
  }>(
    `SELECT ${USER_KEY_SQL} AS user_key,
            MAX(user_id) FILTER (WHERE user_id IS NOT NULL AND TRIM(user_id) <> '') AS user_id,
            MAX(user_email) FILTER (WHERE user_email IS NOT NULL AND TRIM(user_email) <> '') AS email,
            MAX(ended_at) AS last_active,
            COUNT(*)::text AS sessions,
            COALESCE(SUM(total_events), 0)::text AS actions,
            COALESCE(SUM(failure_events), 0)::text AS errors,
            COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000), 0)::text AS duration_ms
     FROM user_sessions
     WHERE project_id = $1 AND (user_id = $2 OR user_email = $2)
     GROUP BY ${USER_KEY_SQL}
     LIMIT 1`,
    [projectId, ident]
  );
  const r = q.rows[0];
  if (!r) return null;
  return {
    userKey: r.user_key,
    userId: r.user_id,
    email: r.email,
    lastActive: r.last_active.toISOString(),
    sessions: Number(r.sessions),
    actions: Number(r.actions),
    errors: Number(r.errors),
    durationMs: Math.round(Number(r.duration_ms)),
  };
}

export async function getUserDays(
  pool: Pool,
  projectId: string,
  userKey: string,
  range: DateRange
) {
  const ident = decodeUserKey(userKey);
  const q = await pool.query<{
    day: string;
    sessions: string;
    actions: string;
    errors: string;
    duration_s: string;
  }>(
    `SELECT (started_at AT TIME ZONE 'UTC')::date::text AS day,
            COUNT(*)::text AS sessions,
            COALESCE(SUM(total_events), 0)::text AS actions,
            COALESCE(SUM(failure_events), 0)::text AS errors,
            COALESCE(SUM(EXTRACT(EPOCH FROM (ended_at - started_at))), 0)::text AS duration_s
     FROM user_sessions
     WHERE project_id = $1
       AND (user_id = $2 OR user_email = $2)
       AND started_at >= $3 AND started_at <= $4
     GROUP BY 1
     ORDER BY 1 DESC`,
    [projectId, ident, range.from, range.to]
  );
  return q.rows.map((r) => ({
    date: r.day,
    sessions: Number(r.sessions),
    actions: Number(r.actions),
    errors: Number(r.errors),
    durationMs: Math.round(Number(r.duration_s) * 1000),
  }));
}

export async function getUserSessionsInRange(
  pool: Pool,
  projectId: string,
  userKey: string,
  range: DateRange
) {
  const ident = decodeUserKey(userKey);
  const q = await pool.query<{
    session_id: string;
    started_at: Date;
    ended_at: Date;
    total_events: number;
    failure_events: number;
  }>(
    `SELECT session_id, started_at, ended_at, total_events, failure_events
     FROM user_sessions
     WHERE project_id = $1
       AND (user_id = $2 OR user_email = $2)
       AND ended_at >= $3 AND started_at <= $4
     ORDER BY started_at DESC`,
    [projectId, ident, range.from, range.to]
  );
  return q.rows.map((r) => ({
    sessionId: r.session_id,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at.toISOString(),
    durationMs: r.ended_at.getTime() - r.started_at.getTime(),
    actions: r.total_events,
    errors: r.failure_events,
  }));
}

export async function getUserTimeline(
  pool: Pool,
  projectId: string,
  userKey: string,
  range: DateRange,
  filters: TimelineFilters
) {
  const ident = decodeUserKey(userKey);
  const sessionIds = await sessionIdsForUser(pool, projectId, ident, range);
  const all = await fetchActionsForSessions(pool, projectId, sessionIds);
  const inRange = all.filter((a) => {
    const t = new Date(a.timestamp).getTime();
    return t >= range.from.getTime() && t <= range.to.getTime();
  });
  const chronological = filterTimeline(inRange, filters).slice(0, 2000);
  const actions = [...chronological].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp.localeCompare(a.timestamp);
    return b.actionIndex - a.actionIndex;
  });
  return {
    actions,
    days: groupActionsByDay(actions),
    map: buildJourneyMap(chronological),
  };
}

export async function getJourneyHome(
  pool: Pool,
  projectId: string,
  range: DateRange
) {
  const users = await listProjectUsers(pool, projectId, { range, limit: 40 });
  const stats = await pool.query<{
    users: string;
    sessions: string;
    errors: string;
    avg_latency: string | null;
  }>(
    `SELECT
       (SELECT COUNT(DISTINCT ${USER_KEY_SQL})::text FROM user_sessions
         WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
           AND ended_at >= $2 AND started_at <= $3) AS users,
       (SELECT COUNT(*)::text FROM user_sessions
         WHERE project_id = $1 AND ended_at >= $2 AND started_at <= $3) AS sessions,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
           AND outcome IN ('FAILURE', 'OTHER')) AS errors,
       (SELECT AVG(latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
           AND latency_ms IS NOT NULL) AS avg_latency`,
    [projectId, range.from, range.to]
  );
  const s = stats.rows[0]!;
  return {
    stats: {
      activeUsers: Number(s.users),
      sessions: Number(s.sessions),
      apiErrors: Number(s.errors),
      avgLatencyMs: s.avg_latency ? Math.round(Number(s.avg_latency)) : 0,
    },
    users,
  };
}

export function pathFromUrl(url: string | null): string {
  if (!url) return "/";
  try {
    if (url.startsWith("http")) {
      const u = new URL(url);
      return u.pathname || "/";
    }
  } catch {
    /* fall through */
  }
  const noHost = url.replace(/^https?:\/\/[^/?#]+/i, "");
  return (noHost.split("?")[0] || url).slice(0, 240) || "/";
}
