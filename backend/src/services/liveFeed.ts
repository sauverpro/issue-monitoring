/**
 * Database side of the live view: seed in-memory stats after a restart, page
 * back through recent events (all traffic, one service or one agent), and load
 * a single event in full with the session journey around it.
 */
import type { Pool } from "pg";
import { classifyHttpResult } from "./httpResultClass.js";
import { statsFor, type LiveEvent } from "./liveStats.js";
import { navKindSql, screenLabelSql } from "./monitorScreenLabel.js";

const API_USER_SQL = `COALESCE(NULLIF(TRIM(e.user_id), ''), NULLIF(TRIM(e.user_email), ''), e.session_id)`;
const ACT_USER_SQL = `COALESCE(NULLIF(TRIM(us.user_id), ''), NULLIF(TRIM(us.user_email), ''), a.session_id)`;

type ApiRow = {
  id: string;
  session_id: string | null;
  user_key: string;
  email: string | null;
  user_id: string | null;
  service: string;
  method: string | null;
  endpoint: string;
  status_code: number | null;
  latency_ms: number | null;
  outcome: string | null;
  current_screen: string | null;
  occurred_at: Date;
  platform: string | null;
  app_version: string | null;
};

type ActRow = {
  id: string;
  session_id: string;
  user_key: string;
  email: string | null;
  user_id: string | null;
  kind: string;
  message: string;
  screen: string | null;
  from_screen: string | null;
  occurred_at: Date;
  platform: string | null;
  app_version: string | null;
};

export function apiRowToLive(r: ApiRow): LiveEvent {
  return {
    id: r.id,
    kind: "api",
    at: r.occurred_at.toISOString(),
    sessionId: r.session_id ?? "",
    userKey: r.user_key,
    email: r.email,
    userId: r.user_id,
    service: r.service,
    method: (r.method ?? "GET").toUpperCase(),
    path: r.endpoint,
    status: r.status_code,
    latencyMs: r.latency_ms,
    result: classifyHttpResult(r.status_code, r.outcome),
    screen: r.current_screen,
    platform: r.platform,
    appVersion: r.app_version,
  };
}

export function actRowToLive(r: ActRow): LiveEvent {
  return {
    id: r.id,
    kind: r.kind,
    at: r.occurred_at.toISOString(),
    sessionId: r.session_id,
    userKey: r.user_key,
    email: r.email,
    userId: r.user_id,
    screen: r.screen,
    fromScreen: r.from_screen,
    message: r.message,
    platform: r.platform,
    appVersion: r.app_version,
  };
}

const API_SELECT = `
  SELECT COALESCE(e.sentry_event_id, 'api:' || e.id::text) AS id, e.session_id, ${API_USER_SQL} AS user_key,
         NULLIF(TRIM(e.user_email), '') AS email, NULLIF(TRIM(e.user_id), '') AS user_id,
         e.service, e.http_method AS method, e.endpoint, e.status_code, e.latency_ms, e.outcome,
         e.current_screen, e.occurred_at, us.platform, us.app_version
  FROM api_events_real e
  LEFT JOIN user_sessions us ON us.session_id = e.session_id`;

const ACT_SELECT = `
  SELECT COALESCE(a.sentry_event_id, 'act:' || a.id::text) AS id, a.session_id, ${ACT_USER_SQL} AS user_key,
         NULLIF(TRIM(us.user_email), '') AS email, NULLIF(TRIM(us.user_id), '') AS user_id,
         a.kind, a.message, ${screenLabelSql("a")} AS screen, NULLIF(TRIM(a.from_screen), '') AS from_screen,
         a.occurred_at, us.platform, us.app_version
  FROM session_actions a
  LEFT JOIN user_sessions us ON us.session_id = a.session_id`;

/** Journey rows carry no user columns; resolve the agent through their sessions (indexed). */
function actUserFilter(i: number): string {
  return `(a.session_id IN (SELECT us2.session_id FROM user_sessions us2 WHERE us2.project_id = $1
            AND COALESCE(NULLIF(TRIM(us2.user_id), ''), NULLIF(TRIM(us2.user_email), ''), us2.session_id) = $${i})
          OR a.session_id = $${i})`;
}

const seeding = new Map<string, Promise<void>>();

/** After a restart, rebuild the last hour of presence and 15 minutes of service stats from the database. */
export function ensureSeeded(pool: Pool, projectId: string): Promise<void> {
  const stats = statsFor(projectId);
  if (stats.seededAt) return Promise.resolve();
  let p = seeding.get(projectId);
  if (!p) {
    p = (async () => {
      const [api, act] = await Promise.all([
        pool.query<ApiRow>(
          `${API_SELECT} WHERE e.project_id = $1 AND e.occurred_at >= now() - interval '60 minutes'
           ORDER BY e.occurred_at ASC LIMIT 20000`,
          [projectId]
        ),
        pool.query<ActRow>(
          `${ACT_SELECT} WHERE a.project_id = $1 AND a.occurred_at >= now() - interval '60 minutes'
           ORDER BY a.occurred_at ASC LIMIT 20000`,
          [projectId]
        ),
      ]);
      for (const r of api.rows) stats.record(apiRowToLive(r));
      for (const r of act.rows) stats.record(actRowToLive(r));
      stats.seededAt = Date.now();
    })().finally(() => seeding.delete(projectId));
    seeding.set(projectId, p);
  }
  return p;
}

/** Newest-first page of events, optionally for one agent / one service / failures only. */
export async function recentEvents(
  pool: Pool,
  projectId: string,
  opts: { userKey?: string; service?: string; failuresOnly?: boolean; before?: Date; limit?: number }
): Promise<LiveEvent[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const before = opts.before ?? new Date(Date.now() + 60_000);
  const apiConds = [`e.project_id = $1`, `e.occurred_at < $2`];
  const actConds = [`a.project_id = $1`, `a.occurred_at < $2`];
  const params: unknown[] = [projectId, before];
  if (opts.userKey) {
    params.push(opts.userKey);
    apiConds.push(`${API_USER_SQL} = $${params.length}`);
    actConds.push(actUserFilter(params.length));
  }
  if (opts.service) {
    params.push(opts.service);
    apiConds.push(`e.service = $${params.length}`);
  }
  if (opts.failuresOnly) {
    apiConds.push(`NOT ((e.status_code BETWEEN 200 AND 399) OR (COALESCE(e.status_code, 0) = 0 AND UPPER(COALESCE(e.outcome, '')) = 'SUCCESS'))`);
  }
  params.push(limit);
  const lim = `$${params.length}`;
  // Journey actions only make sense in the unfiltered or per-agent feed.
  const withActions = !opts.service && !opts.failuresOnly;
  const [api, act] = await Promise.all([
    pool.query<ApiRow>(`${API_SELECT} WHERE ${apiConds.join(" AND ")} ORDER BY e.occurred_at DESC LIMIT ${lim}`, params),
    withActions
      ? pool.query<ActRow>(`${ACT_SELECT} WHERE ${actConds.join(" AND ")} ORDER BY a.occurred_at DESC LIMIT ${lim}`, params)
      : Promise.resolve({ rows: [] as ActRow[] }),
  ]);
  return [...api.rows.map(apiRowToLive), ...act.rows.map(actRowToLive)]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

export type LiveEventDetail = {
  event: LiveEvent;
  api?: {
    url: string | null;
    requestBody: string | null;
    responseBody: string | null;
    failureReason: string | null;
    errorCode: string | null;
    upstreamKey: string | null;
  };
  payload?: unknown;
  session: {
    id: string;
    startedAt: string | null;
    endedAt: string | null;
    platform: string | null;
    os: string | null;
    appVersion: string | null;
    network: string | null;
    totalEvents: number | null;
    failureEvents: number | null;
  } | null;
  /** The screens the agent moved through in this session up to the event (oldest first). */
  screenPath: { screen: string; at: string }[];
  /** Events just before and after, in time order (includes the event itself). */
  around: LiveEvent[];
};

/** Events without a stable id are addressed as `api:<id>` / `act:<uuid>`. */
function idParam(eventId: string, prefix: "api" | "act"): [string, string | null] {
  return [eventId, eventId.startsWith(`${prefix}:`) ? eventId.slice(prefix.length + 1) : null];
}
function idMatch(alias: string, i: number): string {
  return `(${alias}.sentry_event_id = $${i} OR (${alias}.sentry_event_id IS NULL AND ${alias}.id::text = $${i + 1}))`;
}

export async function eventDetail(pool: Pool, projectId: string, eventId: string): Promise<LiveEventDetail | null> {
  const api = await pool.query<ApiRow & {
    request_url: string | null;
    request_body: string | null;
    response_body: string | null;
    failure_reason: string | null;
    error_code: string | null;
    upstream_key: string | null;
  }>(
    `${API_SELECT.replace("FROM api_events_real e", "FROM api_events e").replace("e.current_screen,", "e.current_screen, e.request_url, e.request_body, e.response_body, e.failure_reason, e.error_code, e.upstream_key,")}
     WHERE e.project_id = $1 AND ${idMatch("e", 2)} LIMIT 1`,
    [projectId, ...idParam(eventId, "api")]
  );
  let event: LiveEvent;
  let apiPart: LiveEventDetail["api"];
  let payload: unknown;
  if (api.rows[0]) {
    const r = api.rows[0];
    event = apiRowToLive(r);
    apiPart = {
      url: r.request_url,
      requestBody: r.request_body,
      responseBody: r.response_body,
      failureReason: r.failure_reason,
      errorCode: r.error_code,
      upstreamKey: r.upstream_key,
    };
  } else {
    const act = await pool.query<ActRow & { payload: unknown }>(
      `${ACT_SELECT.replace("a.occurred_at, us.platform", "a.occurred_at, a.payload, us.platform")}
       WHERE a.project_id = $1 AND ${idMatch("a", 2)} LIMIT 1`,
      [projectId, ...idParam(eventId, "act")]
    );
    if (!act.rows[0]) return null;
    event = actRowToLive(act.rows[0]);
    payload = act.rows[0].payload;
  }

  const at = new Date(event.at);
  const [sess, path, before, after] = await Promise.all([
    event.sessionId
      ? pool.query(
          `SELECT session_id, started_at, ended_at, platform, os, app_version, network, total_events, failure_events
           FROM user_sessions WHERE session_id = $1`,
          [event.sessionId]
        )
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    event.sessionId
      ? pool.query<{ screen: string; at: Date }>(
          `SELECT ${screenLabelSql("a")} AS screen, a.occurred_at AS at FROM session_actions a
           WHERE a.session_id = $1 AND a.project_id = $2 AND ${navKindSql("a")} AND a.occurred_at <= $3
           ORDER BY a.occurred_at ASC LIMIT 200`,
          [event.sessionId, projectId, at]
        )
      : Promise.resolve({ rows: [] as { screen: string; at: Date }[] }),
    recentEvents(pool, projectId, { userKey: event.userKey, before: new Date(at.getTime() + 1), limit: 12 }),
    recentAfter(pool, projectId, event.userKey, at, 6),
  ]);
  const s = sess.rows[0] as Record<string, unknown> | undefined;
  // Collapse consecutive repeats so the path reads like a journey.
  const screenPath: { screen: string; at: string }[] = [];
  for (const r of path.rows) {
    if (screenPath[screenPath.length - 1]?.screen !== r.screen) screenPath.push({ screen: r.screen, at: r.at.toISOString() });
  }
  const aroundMap = new Map<string, LiveEvent>();
  for (const e of [...before, ...after]) aroundMap.set(e.id, e);
  return {
    event,
    api: apiPart,
    payload,
    session: s
      ? {
          id: s.session_id as string,
          startedAt: s.started_at ? (s.started_at as Date).toISOString() : null,
          endedAt: s.ended_at ? (s.ended_at as Date).toISOString() : null,
          platform: (s.platform as string) ?? null,
          os: (s.os as string) ?? null,
          appVersion: (s.app_version as string) ?? null,
          network: (s.network as string) ?? null,
          totalEvents: (s.total_events as number) ?? null,
          failureEvents: (s.failure_events as number) ?? null,
        }
      : null,
    screenPath: screenPath.slice(-25),
    around: [...aroundMap.values()].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

async function recentAfter(pool: Pool, projectId: string, userKey: string, at: Date, limit: number): Promise<LiveEvent[]> {
  const [api, act] = await Promise.all([
    pool.query<ApiRow>(
      `${API_SELECT} WHERE e.project_id = $1 AND ${API_USER_SQL} = $2 AND e.occurred_at > $3 ORDER BY e.occurred_at ASC LIMIT $4`,
      [projectId, userKey, at, limit]
    ),
    pool.query<ActRow>(
      `${ACT_SELECT} WHERE a.project_id = $1 AND ${actUserFilter(2)} AND a.occurred_at > $3 ORDER BY a.occurred_at ASC LIMIT $4`,
      [projectId, userKey, at, limit]
    ),
  ]);
  return [...api.rows.map(apiRowToLive), ...act.rows.map(actRowToLive)]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, limit);
}
