import type { Pool } from "pg";
import { buildSessionSummary, extractFailures } from "./sessionSummary.js";
import { sortActionsByIndex } from "./sentry/sentryClient.js";
import type {
  SessionAction,
  SessionActionsResponse,
  SessionListItem,
} from "../types/sessionInvestigation.js";

export async function listProjectSessions(
  pool: Pool,
  projectId: string,
  opts: {
    limit?: number;
    email?: string;
    sessionId?: string;
    failuresOnly?: boolean;
    from?: Date;
    to?: Date;
  }
): Promise<SessionListItem[]> {
  const limit = opts.limit ?? 50;
  const conds = [`project_id = $1`];
  const params: unknown[] = [projectId];
  let i = 2;
  if (opts.email) {
    conds.push(`(user_email ILIKE $${i} OR user_id ILIKE $${i} OR session_id ILIKE $${i})`);
    params.push(`%${opts.email}%`);
    i++;
  }
  if (opts.sessionId) {
    conds.push(`session_id ILIKE $${i++}`);
    params.push(`%${opts.sessionId}%`);
  }
  if (opts.failuresOnly) {
    conds.push(`failure_events > 0`);
  }
  if (opts.from) {
    conds.push(`ended_at >= $${i++}`);
    params.push(opts.from);
  }
  if (opts.to) {
    conds.push(`started_at <= $${i++}`);
    params.push(opts.to);
  }
  params.push(limit);
  const q = await pool.query<{
    session_id: string;
    user_id: string | null;
    user_email: string | null;
    role: string | null;
    account_type: string | null;
    total_events: number;
    failure_events: number;
    started_at: Date;
    ended_at: Date;
  }>(
    `SELECT session_id, user_id, user_email, role, account_type, total_events, failure_events, started_at, ended_at
     FROM user_sessions
     WHERE ${conds.join(" AND ")}
     ORDER BY ended_at DESC
     LIMIT $${i}`,
    params
  );
  return q.rows.map((r) => ({
    sessionId: r.session_id,
    userId: r.user_id,
    userEmail: r.user_email,
    role: r.role,
    accountType: r.account_type,
    totalActions: r.total_events,
    failures: r.failure_events,
    startedAt: r.started_at.toISOString(),
    lastActivity: r.ended_at.toISOString(),
  }));
}

function mapApiRow(row: Record<string, unknown>, idx: number): SessionAction {
  const status =
    row.outcome === "SUCCESS"
      ? "success"
      : row.outcome === "FAILURE"
        ? "failure"
        : "other";
  const statusCode = Number(row.status_code);
  const httpStatus =
    statusCode > 0
      ? String(statusCode)
      : row.failure_reason
        ? String(row.failure_reason)
        : row.outcome === "OTHER"
          ? "FETCH_ERROR"
          : null;
  const occurred = row.occurred_at as Date;
  return {
    id: (row.sentry_event_id as string | null) ?? `api:${String(occurred)}:${idx}`,
    timestamp: occurred.toISOString(),
    message: null,
    type: (row.sentry_type as string | null) ?? null,
    status,
    actionType: "api_call",
    service: (row.service as string | null) ?? (row.app_service as string | null),
    method: (row.http_method as string | null) ?? null,
    endpoint: (row.request_url as string | null) ?? (row.endpoint as string | null),
    httpStatus,
    actionIndex: (row.action_index as number | null) ?? idx,
    orderId: null,
    failureReason: (row.failure_reason as string | null) ?? null,
    role: (row.user_role as string | null) ?? null,
    accountType: (row.account_type as string | null) ?? null,
    screen: (row.current_screen as string | null) ?? null,
    latencyMs: row.latency_ms != null ? Number(row.latency_ms) : null,
    responseBody: (row.response_body as string | null) ?? null,
    requestBody: (row.request_body as string | null) ?? null,
    sessionId: (row.session_id as string | null) ?? null,
  };
}

function mapJourneyRow(
  row: {
    kind: string;
    occurred_at: Date;
    message: string | null;
    screen: string | null;
    from_screen: string | null;
    sentry_event_id: string | null;
    payload: Record<string, unknown> | null;
    session_id?: string | null;
  },
  idx: number,
  role: string | null,
  accountType: string | null
): SessionAction {
  return {
    id: row.sentry_event_id
      ? `journey:${row.sentry_event_id}:${row.kind}:${idx}`
      : `journey:${row.kind}:${row.occurred_at.toISOString()}:${idx}`,
    timestamp: row.occurred_at.toISOString(),
    message: row.message,
    type: row.kind,
    status: row.kind === "auth" || row.kind === "purchase_complete" ? "success" : "info",
    actionType: row.kind,
    service: null,
    method: null,
    endpoint: row.screen ?? row.from_screen,
    httpStatus: null,
    actionIndex: typeof row.payload?.action_index === "number" ? row.payload.action_index : idx,
    orderId: null,
    failureReason: null,
    role,
    accountType,
    screen: row.screen,
    latencyMs: null,
    responseBody: null,
    requestBody: null,
    target: typeof row.payload?.target === "string" ? row.payload.target : null,
    sessionId: row.session_id ?? null,
  };
}

export async function fetchActionsForSessions(
  pool: Pool,
  projectId: string,
  sessionIds: string[]
): Promise<SessionAction[]> {
  if (sessionIds.length === 0) return [];
  const result = await pool.query(
    `SELECT sentry_event_id, occurred_at, app_service, endpoint, request_url, status_code,
            outcome, action_index, sentry_type, failure_reason, user_role, account_type,
            latency_ms, current_screen, http_method, response_body, request_body, service,
            session_id
     FROM api_events
     WHERE project_id = $1 AND session_id = ANY($2::text[])
     ORDER BY occurred_at ASC, COALESCE(action_index, 999999) ASC`,
    [projectId, sessionIds]
  );
  const api = result.rows.map((row, idx) => mapApiRow(row, idx));

  const journey = await pool.query<{
    kind: string;
    occurred_at: Date;
    message: string | null;
    screen: string | null;
    from_screen: string | null;
    sentry_event_id: string | null;
    payload: Record<string, unknown> | null;
    session_id: string | null;
  }>(
    `SELECT kind, occurred_at, message, screen, from_screen, sentry_event_id, payload, session_id
     FROM session_actions
     WHERE project_id = $1 AND session_id = ANY($2::text[])
     ORDER BY occurred_at ASC`,
    [projectId, sessionIds]
  );
  const journeyActions = journey.rows.map((row, idx) => mapJourneyRow(row, idx, null, null));
  return sortActionsByIndex([...api, ...journeyActions]);
}

export async function getProjectSessionActions(
  pool: Pool,
  projectId: string,
  sessionId: string
): Promise<SessionActionsResponse | null> {
  const sess = await pool.query<{
    user_id: string | null;
    user_email: string | null;
    role: string | null;
    account_type: string | null;
    platform: string | null;
    os: string | null;
    app_version: string | null;
    network: string | null;
    started_at: Date;
    ended_at: Date;
    total_events: number;
    failure_events: number;
  }>(
    `SELECT user_id, user_email, role, account_type, platform, os, app_version, network,
            started_at, ended_at, total_events, failure_events
     FROM user_sessions WHERE session_id = $1 AND project_id = $2`,
    [sessionId, projectId]
  );
  const sessionRow = sess.rows[0];
  const actions = await fetchActionsForSessions(pool, projectId, [sessionId]);
  if (!sessionRow && actions.length === 0) return null;

  return {
    sessionId,
    user: {
      id: sessionRow?.user_id ?? null,
      email: sessionRow?.user_email ?? null,
      role: sessionRow?.role ?? null,
      accountType: sessionRow?.account_type ?? null,
    },
    summary: buildSessionSummary(actions),
    actions,
    startedAt: sessionRow?.started_at.toISOString() ?? null,
    endedAt: sessionRow?.ended_at.toISOString() ?? null,
    device: {
      platform: sessionRow?.platform ?? null,
      os: sessionRow?.os ?? null,
      appVersion: sessionRow?.app_version ?? null,
      network: sessionRow?.network ?? null,
    },
  };
}

export async function getProjectSessionFailures(
  pool: Pool,
  projectId: string,
  sessionId: string
) {
  const data = await getProjectSessionActions(pool, projectId, sessionId);
  if (!data) return null;
  return { sessionId, failures: extractFailures(data.actions) };
}
