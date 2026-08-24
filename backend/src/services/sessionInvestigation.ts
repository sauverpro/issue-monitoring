import type { Pool } from "pg";
import {
  cacheGet,
  cacheSet,
  cacheKeySession,
  cacheKeySessionList,
} from "./cache.js";
import {
  fetchSessionEventsFromSentry,
  extractUserFromActions,
  sortActionsByIndex,
} from "./sentry/sentryClient.js";
import { buildSessionSummary, extractFailures } from "./sessionSummary.js";
import type {
  SessionAction,
  SessionActionsResponse,
  SessionListItem,
  SessionFailuresResponse,
} from "../types/sessionInvestigation.js";
import { config } from "../config.js";

export type SessionListFilters = {
  page: number;
  limit: number;
  email?: string;
  role?: string;
  accountType?: string;
  status?: "all" | "failures" | "success";
  startDate?: string;
  endDate?: string;
  sessionId?: string;
};

function hashFilters(f: SessionListFilters): string {
  return JSON.stringify(f);
}

async function actionsFromPostgres(
  pool: Pool,
  sessionId: string
): Promise<SessionAction[]> {
  const result = await pool.query(
    `SELECT sentry_event_id, occurred_at, app_service, endpoint, request_url, status_code,
            outcome, action_index, sentry_type, failure_reason, user_role, account_type,
            latency_ms, current_screen, http_method, response_body, service
     FROM api_events
     WHERE session_id = $1
     ORDER BY occurred_at ASC, COALESCE(action_index, 999999) ASC`,
    [sessionId]
  );

  const api: SessionAction[] = result.rows.map((row, i) => {
    const status =
      row.outcome === "SUCCESS"
        ? "success"
        : row.outcome === "FAILURE"
          ? "failure"
          : "other";
    const httpStatus =
      row.status_code && Number(row.status_code) > 0
        ? String(row.status_code)
        : row.failure_reason
          ? String(row.failure_reason)
          : row.outcome === "OTHER"
            ? "FETCH_ERROR"
            : null;
    return {
      id: row.sentry_event_id ?? `api:${String(row.occurred_at)}:${i}`,
      timestamp: (row.occurred_at as Date).toISOString(),
      message: null,
      type: row.sentry_type,
      status,
      actionType: "api_call",
      service: row.service ?? row.app_service,
      method: row.http_method ?? null,
      endpoint: row.request_url ?? row.endpoint,
      httpStatus,
      actionIndex: row.action_index ?? i,
      orderId: null,
      failureReason: row.failure_reason,
      role: row.user_role,
      accountType: row.account_type,
      screen: row.current_screen ?? null,
      latencyMs: row.latency_ms != null ? Number(row.latency_ms) : null,
      responseBody: row.response_body ?? null,
    };
  });

  const journey = await pool.query<{
    kind: string;
    occurred_at: Date;
    message: string | null;
    screen: string | null;
    from_screen: string | null;
    sentry_event_id: string | null;
    payload: Record<string, unknown> | null;
  }>(
    `SELECT kind, occurred_at, message, screen, from_screen, sentry_event_id, payload
     FROM session_actions
     WHERE session_id = $1
     ORDER BY occurred_at ASC`,
    [sessionId]
  );

  const journeyActions: SessionAction[] = journey.rows.map((row, i) => ({
    id: row.sentry_event_id
      ? `journey:${row.sentry_event_id}:${row.kind}:${i}`
      : `journey:${row.kind}:${(row.occurred_at as Date).toISOString()}:${i}`,
    timestamp: (row.occurred_at as Date).toISOString(),
    message: row.message,
    type: row.kind,
    status: row.kind === "auth" ? "success" : "info",
    actionType: row.kind,
    service: null,
    method: null,
    endpoint: row.screen ?? row.from_screen,
    httpStatus: null,
    actionIndex: i,
    orderId: null,
    failureReason: null,
    role: typeof row.payload?.role === "string" ? row.payload.role : null,
    accountType:
      typeof row.payload?.account_type === "string" ? row.payload.account_type : null,
    screen: row.screen,
    latencyMs: null,
    responseBody: null,
  }));

  return [...api, ...journeyActions];
}

function mergeActions(primary: SessionAction[], extra: SessionAction[]): SessionAction[] {
  const seen = new Set(primary.map((a) => `${a.actionType}:${a.timestamp}:${a.endpoint ?? a.message ?? a.id}`));
  const out = [...primary];
  for (const a of extra) {
    const key = `${a.actionType}:${a.timestamp}:${a.endpoint ?? a.message ?? a.id}`;
    if (seen.has(key) || seen.has(a.id)) continue;
    seen.add(key);
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

export async function getSessionActions(
  pool: Pool,
  sessionId: string,
  preferSentry = true
): Promise<SessionActionsResponse> {
  const cacheKey = cacheKeySession(sessionId);
  const cached = cacheGet<SessionActionsResponse>(cacheKey);
  if (cached) return cached;

  let actions = await actionsFromPostgres(pool, sessionId);

  if (preferSentry && config.sentry.authToken) {
    try {
      const fromSentry = await fetchSessionEventsFromSentry(sessionId);
      actions = mergeActions(actions, fromSentry);
    } catch (err) {
      console.warn("[session] Sentry fetch failed, using Postgres", err);
    }
  }

  actions = sortActionsByIndex(actions);
  actions = actions.map((a, i) => ({ ...a, actionIndex: a.actionIndex || i }));

  const userFromTags = extractUserFromActions(actions);
  const pgUser = await pool.query<{
    user_id: string | null;
    user_email: string | null;
    role: string | null;
    account_type: string | null;
  }>(
    `SELECT user_id, user_email, role, account_type FROM user_sessions WHERE session_id = $1`,
    [sessionId]
  );
  const pu = pgUser.rows[0];

  const response: SessionActionsResponse = {
    sessionId,
    user: {
      id: pu?.user_id ?? userFromTags.id,
      email: pu?.user_email ?? userFromTags.email,
      role: pu?.role ?? userFromTags.role,
      accountType: pu?.account_type ?? userFromTags.accountType,
    },
    summary: buildSessionSummary(actions),
    actions,
  };

  cacheSet(cacheKey, response);
  return response;
}

export async function getSessionFailures(
  pool: Pool,
  sessionId: string
): Promise<SessionFailuresResponse> {
  const { actions } = await getSessionActions(pool, sessionId);
  return {
    sessionId,
    failures: extractFailures(actions),
  };
}

export async function listSessions(
  pool: Pool,
  filters: SessionListFilters
): Promise<{ items: SessionListItem[]; total: number; page: number; limit: number }> {
  const listKey = cacheKeySessionList(hashFilters(filters));
  const cached = cacheGet<{ items: SessionListItem[]; total: number }>(listKey);
  if (cached) {
    return { ...cached, page: filters.page, limit: filters.limit };
  }

  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  let i = 1;

  if (filters.sessionId) {
    conditions.push(`session_id = $${i++}`);
    params.push(filters.sessionId);
  }
  if (filters.email) {
    conditions.push(`user_email ILIKE $${i++}`);
    params.push(`%${filters.email}%`);
  }
  if (filters.role) {
    conditions.push(`role ILIKE $${i++}`);
    params.push(`%${filters.role}%`);
  }
  if (filters.accountType) {
    conditions.push(`account_type ILIKE $${i++}`);
    params.push(`%${filters.accountType}%`);
  }
  if (filters.status === "failures") {
    conditions.push(`failure_events > 0`);
  } else if (filters.status === "success") {
    conditions.push(`failure_events = 0`);
  }
  if (filters.startDate) {
    conditions.push(`started_at >= $${i++}`);
    params.push(new Date(filters.startDate).toISOString());
  }
  if (filters.endDate) {
    conditions.push(`ended_at <= $${i++}`);
    params.push(new Date(filters.endDate).toISOString());
  }

  const where = conditions.join(" AND ");
  const offset = (filters.page - 1) * filters.limit;

  const countR = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM user_sessions WHERE ${where}`,
    params
  );
  const total = Number(countR.rows[0]?.c ?? 0);

  const dataR = await pool.query(
    `SELECT session_id, user_email, role, account_type, total_events, failure_events,
            started_at, ended_at
     FROM user_sessions
     WHERE ${where}
     ORDER BY ended_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    [...params, filters.limit, offset]
  );

  const items: SessionListItem[] = dataR.rows.map((row) => ({
    sessionId: row.session_id,
    userEmail: row.user_email,
    role: row.role,
    accountType: row.account_type,
    totalActions: row.total_events,
    failures: row.failure_events,
    startedAt: (row.started_at as Date).toISOString(),
    lastActivity: (row.ended_at as Date).toISOString(),
  }));

  cacheSet(listKey, { items, total });
  return { items, total, page: filters.page, limit: filters.limit };
}

export type SessionAnalytics = {
  sessionVolume: { date: string; count: number }[];
  errorRateByService: { service: string; errorRate: number; total: number }[];
  failedApiCalls: number;
  topFailingEndpoints: {
    endpoint: string;
    failures: number;
    uniqueUsers: number;
  }[];
  activeUsers: number;
  averageActionsPerSession: number;
};

export async function getSessionAnalytics(
  pool: Pool,
  windowDays = 7
): Promise<SessionAnalytics> {
  const cacheKey = `session:analytics:${windowDays}`;
  const cached = cacheGet<SessionAnalytics>(cacheKey);
  if (cached) return cached;

  const interval = `${windowDays} days`;

  const volumeR = await pool.query<{ d: string; c: string }>(
    `SELECT date_trunc('day', started_at)::date::text AS d, COUNT(*)::text AS c
     FROM user_sessions
     WHERE started_at >= now() - $1::interval
     GROUP BY 1 ORDER BY 1`,
    [interval]
  );

  const serviceR = await pool.query<{
    service: string;
    total: string;
    failures: string;
  }>(
    `SELECT COALESCE(app_service, service) AS service,
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE outcome IN ('FAILURE', 'OTHER'))::text AS failures
     FROM api_events
     WHERE occurred_at >= now() - $1::interval AND ingest_source = 'sentry'
     GROUP BY 1`,
    [interval]
  );

  const failedR = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM api_events
     WHERE occurred_at >= now() - $1::interval AND outcome IN ('FAILURE', 'OTHER')`,
    [interval]
  );

  const topR = await pool.query<{
    endpoint: string;
    failures: string;
    users: string;
  }>(
    `SELECT COALESCE(request_url, endpoint) AS endpoint,
            COUNT(*)::text AS failures,
            COUNT(DISTINCT user_email)::text AS users
     FROM api_events
     WHERE occurred_at >= now() - $1::interval AND outcome IN ('FAILURE', 'OTHER')
     GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
    [interval]
  );

  const usersR = await pool.query<{ c: string }>(
    `SELECT COUNT(DISTINCT user_email)::text AS c FROM user_sessions
     WHERE started_at >= now() - $1::interval AND user_email IS NOT NULL`,
    [interval]
  );

  const avgR = await pool.query<{ avg: string }>(
    `SELECT COALESCE(AVG(total_events), 0)::text AS avg FROM user_sessions
     WHERE started_at >= now() - $1::interval`,
    [interval]
  );

  const analytics: SessionAnalytics = {
    sessionVolume: volumeR.rows.map((r) => ({
      date: r.d,
      count: Number(r.c),
    })),
    errorRateByService: serviceR.rows.map((r) => {
      const total = Number(r.total);
      const failures = Number(r.failures);
      return {
        service: r.service,
        total,
        errorRate: total > 0 ? failures / total : 0,
      };
    }),
    failedApiCalls: Number(failedR.rows[0]?.c ?? 0),
    topFailingEndpoints: topR.rows.map((r) => ({
      endpoint: r.endpoint,
      failures: Number(r.failures),
      uniqueUsers: Number(r.users),
    })),
    activeUsers: Number(usersR.rows[0]?.c ?? 0),
    averageActionsPerSession: Number(avgR.rows[0]?.avg ?? 0),
  };

  cacheSet(cacheKey, analytics);
  return analytics;
}
