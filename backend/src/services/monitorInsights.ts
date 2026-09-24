import type { Pool } from "pg";
import type { DateRange } from "./monitorJourney.js";
import { getReportFunnels, previousRange, pctDelta } from "./monitorReports.js";
import { NAV_KIND_SQL, navKindSql, pickFunnelStart, screenLabelSql } from "./monitorScreenLabel.js";
import { apiOpsStatus, classifyHttpResult, httpResultClassSql, type HttpResultClass } from "./httpResultClass.js";
import { listProjectUpstreams } from "./tenancy.js";
import { matchUpstreamSlug, normalizeHost } from "./monitorHosts.js";

const USER_KEY_SQL = `COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''))`;
/** Same definition as Overview / Users: identified people only — never a session id. */
const IDENTIFIED_USERS_SQL = `COUNT(DISTINCT ${USER_KEY_SQL})`;

/** Pathname of request_url / endpoint, query string stripped. */
export const EVENT_PATH_SQL = `COALESCE(
  NULLIF(
    CASE
      WHEN COALESCE(request_url, endpoint, '') ~* '^https?://' THEN
        regexp_replace(
          split_part(split_part(COALESCE(request_url, endpoint), '?', 1), '://', 2),
          '^[^/]+',
          ''
        )
      ELSE split_part(COALESCE(NULLIF(request_url, ''), endpoint, '/'), '?', 1)
    END,
    ''
  ),
  '/'
)`;

export type ProblemSeverity = "critical" | "high" | "medium" | "low";

export function problemSeverity(opts: {
  statusCode: number | null;
  occurrences: number;
  usersAffected: number;
  resultClass?: HttpResultClass;
}): ProblemSeverity {
  const code = opts.statusCode ?? 0;
  const cls = opts.resultClass ?? classifyHttpResult(code, null);
  const isServer = cls === "server_error" || code >= 500;
  const isNetwork = cls === "network";
  const isClient = cls === "client_failure" || (code >= 400 && code < 500);

  if (isServer && (opts.occurrences >= 80 || opts.usersAffected >= 30)) return "critical";
  if (isServer || opts.occurrences >= 40) return "high";
  if (isNetwork && (opts.occurrences >= 20 || opts.usersAffected >= 15)) return "high";
  if (isClient || isNetwork || opts.occurrences >= 10) return "medium";
  return "low";
}

export function impactFromUsers(
  usersAffected: number,
  totalUsers: number
): { score: number; label: "HIGH" | "MEDIUM" | "LOW" } {
  const score = totalUsers > 0 ? usersAffected / totalUsers : 0;
  if (score >= 0.1 || usersAffected >= 50) return { score, label: "HIGH" };
  if (score >= 0.03 || usersAffected >= 10) return { score, label: "MEDIUM" };
  return { score, label: "LOW" };
}

export function encodeProblemKey(method: string, path: string, statusCode: number | null): string {
  const raw = `${method}::${path}::${statusCode ?? ""}`;
  // base64url — no `/` or `+`, so Express/React Router path params stay intact
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function parseProblemKey(raw: string): { method: string; path: string; statusCode: number | null } {
  let decoded = raw;
  if (/^[A-Za-z0-9_-]+$/.test(raw) && raw.length >= 8) {
    try {
      const fromB64 = Buffer.from(raw, "base64url").toString("utf8");
      if (fromB64.includes("::")) decoded = fromB64;
    } catch {
      /* fall through */
    }
  }
  if (!decoded.includes("::") || decoded === raw) {
    try {
      const uriDecoded = decodeURIComponent(raw);
      if (uriDecoded.includes("::")) decoded = uriDecoded;
    } catch {
      /* keep decoded */
    }
  }
  return parseColonProblemKey(decoded);
}

function parseColonProblemKey(decoded: string): {
  method: string;
  path: string;
  statusCode: number | null;
} {
  const first = decoded.indexOf("::");
  const last = decoded.lastIndexOf("::");
  if (first < 0 || last <= first) {
    return { method: "GET", path: decoded || "/", statusCode: null };
  }
  const method = decoded.slice(0, first) || "GET";
  const path = decoded.slice(first + 2, last) || "/";
  const statusRaw = decoded.slice(last + 2);
  const statusCode = statusRaw === "" ? null : Number(statusRaw);
  return { method, path, statusCode: Number.isFinite(statusCode) ? statusCode : null };
}

export type FunnelStep = { screen: string; users: number; conversion: number };

export function sequentialFunnel(
  start: { screen: string; sessions: number } | undefined,
  transitions: { from: string; to: string; count: number }[]
): FunnelStep[] {
  if (!start || !start.screen) return [];
  const out: FunnelStep[] = [{ screen: start.screen, users: start.sessions, conversion: 1 }];
  const seen = new Set([start.screen.toLowerCase()]);
  let current = start.screen;
  let prevUsers = start.sessions;
  for (let i = 0; i < 6; i++) {
    const next = transitions
      .filter((t) => t.from === current && !seen.has(t.to.toLowerCase()))
      .sort((a, b) => b.count - a.count)[0];
    if (!next) break;
    seen.add(next.to.toLowerCase());
    const users = Math.min(next.count, prevUsers);
    out.push({
      screen: next.to,
      users,
      conversion: prevUsers === 0 ? 0 : users / prevUsers,
    });
    current = next.to;
    prevUsers = users;
  }
  return out;
}

export function largestDropoff(steps: FunnelStep[]): {
  from: string;
  to: string;
  fromCount: number;
  toCount: number;
  rate: number;
} | null {
  let worst: ReturnType<typeof largestDropoff> = null;
  for (let i = 1; i < steps.length; i++) {
    const from = steps[i - 1]!;
    const to = steps[i]!;
    const kept = from.users === 0 ? 1 : to.users / from.users;
    const rate = 1 - kept;
    if (!worst || rate > worst.rate) {
      worst = {
        from: from.screen,
        to: to.screen,
        fromCount: from.users,
        toCount: to.users,
        rate,
      };
    }
  }
  return worst;
}

export function dropoffCauses(from: string, to: string): string[] {
  const hay = `${from} ${to}`.toLowerCase();
  const out = ["API failures", "Slow endpoint", "UX friction"];
  if (hay.includes("ticket") || hay.includes("checkout") || hay.includes("pay")) {
    out.push("Payment initialization");
  }
  return out;
}

export function rankJourneys(
  sequences: string[][],
  limit = 5
): { path: string[]; count: number; pct: number }[] {
  const counts = new Map<string, { path: string[]; n: number }>();
  for (const seq of sequences) {
    const path: string[] = [];
    for (const step of seq) {
      const s = step.trim();
      if (!s) continue;
      if (path[path.length - 1] === s) continue;
      path.push(s);
    }
    if (path.length < 2) continue;
    const clipped = path.slice(0, 6);
    const key = clipped.join("\0");
    const cur = counts.get(key) ?? { path: clipped, n: 0 };
    cur.n += 1;
    counts.set(key, cur);
  }
  const total = Math.max(1, sequences.length);
  return [...counts.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((r) => ({ path: r.path, count: r.n, pct: r.n / total }));
}

export function buildRecommendations(input: {
  errors: { severity: string; method: string; path: string; occurrences: number; usersAffected: number }[];
  slow: { method: string; path: string; p95Ms: number }[];
  dropoff: { from: string; to: string; fromCount: number; toCount: number; rate: number } | null;
}): { priority: "P0" | "P1" | "P2"; title: string; detail: string }[] {
  const recs: { priority: "P0" | "P1" | "P2"; title: string; detail: string }[] = [];
  const top = input.errors[0];
  if (top && (top.severity === "critical" || top.severity === "high")) {
    recs.push({
      priority: "P0",
      title: `${top.method} ${top.path} produces ${top.occurrences} failures.`,
      detail: `${top.usersAffected} users affected.`,
    });
  }
  const slow = input.slow.find((s) => s.p95Ms >= 2000) ?? input.slow[0];
  if (slow && slow.p95Ms >= 1500) {
    recs.push({
      priority: "P1",
      title: `P95 latency above ${(slow.p95Ms / 1000).toFixed(1)} seconds.`,
      detail: `${slow.method} ${slow.path}`,
    });
  }
  if (input.dropoff && input.dropoff.rate > 0.2) {
    recs.push({
      priority: "P2",
      title: `High exit rate on ${input.dropoff.to} screen.`,
      detail: `${input.dropoff.from} → ${input.dropoff.to}: ${input.dropoff.fromCount} → ${input.dropoff.toCount}.`,
    });
  }
  return recs.slice(0, 5);
}

type ProblemRow = {
  method: string;
  path: string;
  statusCode: number | null;
  failureReason: string | null;
  resultClass: HttpResultClass;
  occurrences: number;
  usersAffected: number;
  sessionsAffected: number;
  firstSeen: string;
  lastSeen: string;
  avgLatencyMs: number;
  errorRate: number;
  severity: ProblemSeverity;
  impact: { score: number; label: "HIGH" | "MEDIUM" | "LOW" };
};

async function loadFailureGroups(pool: Pool, projectId: string, range: DateRange) {
  const resultClass = httpResultClassSql();
  const q = await pool.query<{
    method: string | null;
    path: string;
    status_code: number | null;
    failure_reason: string | null;
    result_class: string;
    occurrences: string;
    users_affected: string;
    sessions_affected: string;
    first_seen: Date;
    last_seen: Date;
    avg_latency: string | null;
  }>(
    `SELECT COALESCE(http_method, 'GET') AS method,
            ${EVENT_PATH_SQL} AS path,
            status_code,
            MIN(failure_reason) AS failure_reason,
            ${resultClass} AS result_class,
            COUNT(*)::text AS occurrences,
            ${IDENTIFIED_USERS_SQL}::text AS users_affected,
            COUNT(DISTINCT session_id)::text AS sessions_affected,
            MIN(occurred_at) AS first_seen,
            MAX(occurred_at) AS last_seen,
            AVG(latency_ms)::text AS avg_latency
     FROM api_events
     WHERE project_id = $1
       AND occurred_at >= $2 AND occurred_at <= $3
       AND (${resultClass}) IN ('client_failure', 'server_error', 'network')
     GROUP BY COALESCE(http_method, 'GET'), ${EVENT_PATH_SQL}, status_code, ${resultClass}
     ORDER BY COUNT(*) DESC
     LIMIT 80`,
    [projectId, range.from, range.to]
  );

  const totals = await pool.query<{ method: string | null; path: string; total: string }>(
    `SELECT COALESCE(http_method, 'GET') AS method,
            ${EVENT_PATH_SQL} AS path,
            COUNT(*)::text AS total
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
     GROUP BY 1, 2`,
    [projectId, range.from, range.to]
  );
  const totalMap = new Map(totals.rows.map((r) => [`${r.method ?? "GET"}\0${r.path}`, Number(r.total)]));

  const usersQ = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT ${USER_KEY_SQL})::text AS n FROM user_sessions
     WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
       AND ended_at >= $2 AND started_at <= $3`,
    [projectId, range.from, range.to]
  );
  const totalUsers = Number(usersQ.rows[0]?.n ?? 0);

  const errors: ProblemRow[] = q.rows.map((r) => {
    const method = r.method ?? "GET";
    const occurrences = Number(r.occurrences);
    const usersAffected = Number(r.users_affected);
    const total = totalMap.get(`${method}\0${r.path}`) ?? occurrences;
    const cls = (r.result_class as HttpResultClass) || "client_failure";
    const severity = problemSeverity({
      statusCode: r.status_code,
      occurrences,
      usersAffected,
      resultClass: cls,
    });
    return {
      method,
      path: r.path || "/",
      statusCode: r.status_code,
      failureReason: r.failure_reason,
      resultClass: cls,
      occurrences,
      usersAffected,
      sessionsAffected: Number(r.sessions_affected),
      firstSeen: r.first_seen.toISOString(),
      lastSeen: r.last_seen.toISOString(),
      avgLatencyMs: r.avg_latency ? Math.round(Number(r.avg_latency)) : 0,
      errorRate: total === 0 ? 0 : occurrences / total,
      severity,
      impact: impactFromUsers(usersAffected, totalUsers),
    };
  });

  return { errors, totalUsers };
}

export async function getProjectProblems(pool: Pool, projectId: string, range: DateRange) {
  const prev = previousRange(range);
  const [{ errors, totalUsers }, , summary, prevSummary, slow] = await Promise.all([
    loadFailureGroups(pool, projectId, range),
    loadFailureGroups(pool, projectId, prev),
    problemSummaryStats(pool, projectId, range),
    problemSummaryStats(pool, projectId, prev),
    loadSlowEndpoints(pool, projectId, range),
  ]);

  const priority = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const e of errors) priority[e.severity] += 1;

  return {
    summary: {
      totalErrors: summary.errors,
      totalErrorsDelta: pctDelta(summary.errors, prevSummary.errors),
      usersAffected: summary.users,
      usersAffectedDelta: pctDelta(summary.users, prevSummary.users),
      errors5xx: summary.serverError,
      errors5xxDelta: pctDelta(summary.serverError, prevSummary.serverError),
      clientFailures: summary.clientFailure,
      clientFailuresDelta: pctDelta(summary.clientFailure, prevSummary.clientFailure),
      networkErrors: summary.network,
      networkErrorsDelta: pctDelta(summary.network, prevSummary.network),
      critical: priority.critical,
      usersInRange: totalUsers,
    },
    byClass: {
      clientFailure: summary.clientFailure,
      serverError: summary.serverError,
      network: summary.network,
    },
    priority,
    errors,
    slow,
  };
}

async function problemSummaryStats(pool: Pool, projectId: string, range: DateRange) {
  const resultClass = httpResultClassSql();
  const q = await pool.query<{
    errors: string;
    users: string;
    client_failure: string;
    server_error: string;
    network: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE (${resultClass}) IN ('client_failure','server_error','network'))::text AS errors,
       ${IDENTIFIED_USERS_SQL}
         FILTER (WHERE (${resultClass}) IN ('client_failure','server_error','network'))::text AS users,
       COUNT(*) FILTER (WHERE (${resultClass}) = 'client_failure')::text AS client_failure,
       COUNT(*) FILTER (WHERE (${resultClass}) = 'server_error')::text AS server_error,
       COUNT(*) FILTER (WHERE (${resultClass}) = 'network')::text AS network
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3`,
    [projectId, range.from, range.to]
  );
  const r = q.rows[0]!;
  return {
    errors: Number(r.errors),
    users: Number(r.users),
    clientFailure: Number(r.client_failure),
    serverError: Number(r.server_error),
    network: Number(r.network),
  };
}

async function loadSlowEndpoints(pool: Pool, projectId: string, range: DateRange) {
  const slow = await pool.query<{
    method: string | null;
    path: string;
    occurrences: string;
    avg_latency: string | null;
    p95: string | null;
    last_seen: Date;
  }>(
    `SELECT COALESCE(http_method, 'GET') AS method,
            ${EVENT_PATH_SQL} AS path,
            COUNT(*)::text AS occurrences,
            AVG(latency_ms)::text AS avg_latency,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::text AS p95,
            MAX(occurred_at) AS last_seen
     FROM api_events
     WHERE project_id = $1
       AND occurred_at >= $2 AND occurred_at <= $3
       AND latency_ms IS NOT NULL
     GROUP BY COALESCE(http_method, 'GET'), ${EVENT_PATH_SQL}
     HAVING AVG(latency_ms) >= 2000
     ORDER BY AVG(latency_ms) DESC
     LIMIT 15`,
    [projectId, range.from, range.to]
  );
  return slow.rows.map((r) => ({
    severity: "low" as const,
    method: r.method ?? "GET",
    path: r.path || "/",
    occurrences: Number(r.occurrences),
    avgLatencyMs: r.avg_latency ? Math.round(Number(r.avg_latency)) : 0,
    p95Ms: r.p95 ? Math.round(Number(r.p95)) : 0,
    lastSeen: r.last_seen.toISOString(),
  }));
}

export async function getProblemDetail(
  pool: Pool,
  projectId: string,
  range: DateRange,
  key: { method: string; path: string; statusCode: number | null }
) {
  const params: unknown[] = [projectId, range.from, range.to, key.method, key.path];
  let statusSql = "status_code IS NULL";
  if (key.statusCode != null) {
    statusSql = "status_code = $6";
    params.push(key.statusCode);
  }

  const resultClass = httpResultClassSql();
  const fail = await pool.query<{
    occurrences: string;
    users_affected: string;
    sessions_affected: string;
    first_seen: Date | null;
    last_seen: Date | null;
    avg_latency: string | null;
    p50: string | null;
    p95: string | null;
    p99: string | null;
    failure_reason: string | null;
  }>(
    `SELECT COUNT(*)::text AS occurrences,
            ${IDENTIFIED_USERS_SQL}::text AS users_affected,
            COUNT(DISTINCT session_id)::text AS sessions_affected,
            MIN(occurred_at) AS first_seen,
            MAX(occurred_at) AS last_seen,
            AVG(latency_ms)::text AS avg_latency,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::text AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::text AS p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::text AS p99,
            MIN(failure_reason) AS failure_reason
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       AND (${resultClass}) IN ('client_failure','server_error','network')
       AND COALESCE(http_method, 'GET') = $4
       AND ${EVENT_PATH_SQL} = $5
       AND ${statusSql}`,
    params
  );

  const totals = await pool.query<{
    total: string;
    avg: string | null;
    p50: string | null;
    p95: string | null;
    p99: string | null;
  }>(
    `SELECT COUNT(*)::text AS total,
            AVG(latency_ms)::text AS avg,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::text AS p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::text AS p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::text AS p99
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       AND COALESCE(http_method, 'GET') = $4
       AND ${EVENT_PATH_SQL} = $5`,
    [projectId, range.from, range.to, key.method, key.path]
  );

  const trend = await pool.query<{ date: string; n: string }>(
    `SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS date, COUNT(*)::text AS n
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       AND (${resultClass}) IN ('client_failure','server_error','network')
       AND COALESCE(http_method, 'GET') = $4
       AND ${EVENT_PATH_SQL} = $5
       AND ${statusSql}
     GROUP BY 1
     ORDER BY 1`,
    params
  );

  const users = await getProblemAffectedUsers(pool, projectId, range, key, { limit: 12 });

  const f = fail.rows[0]!;
  const t = totals.rows[0]!;
  const occurrences = Number(f.occurrences);
  const usersAffected = Number(f.users_affected);
  const total = Number(t.total);
  const cls = classifyHttpResult(key.statusCode, key.statusCode === 0 ? "OTHER" : null);
  const severity = problemSeverity({
    statusCode: key.statusCode,
    occurrences,
    usersAffected,
    resultClass: cls,
  });
  const usersQ = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT ${USER_KEY_SQL})::text AS n FROM user_sessions
     WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
       AND ended_at >= $2 AND started_at <= $3`,
    [projectId, range.from, range.to]
  );

  return {
    method: key.method,
    path: key.path,
    statusCode: key.statusCode,
    failureReason: f.failure_reason,
    resultClass: cls,
    severity,
    occurrences,
    usersAffected,
    sessionsAffected: Number(f.sessions_affected),
    firstSeen: f.first_seen?.toISOString() ?? null,
    lastSeen: f.last_seen?.toISOString() ?? null,
    errorRate: total === 0 ? 0 : occurrences / total,
    avgLatencyMs: t.avg ? Math.round(Number(t.avg)) : f.avg_latency ? Math.round(Number(f.avg_latency)) : 0,
    p50Ms: t.p50 ? Math.round(Number(t.p50)) : f.p50 ? Math.round(Number(f.p50)) : 0,
    p95Ms: t.p95 ? Math.round(Number(t.p95)) : 0,
    p99Ms: t.p99 ? Math.round(Number(t.p99)) : 0,
    impact: impactFromUsers(usersAffected, Number(usersQ.rows[0]?.n ?? 0)),
    trend: trend.rows.map((r) => ({ date: r.date, count: Number(r.n) })),
    users: users.users,
  };
}

export async function getProblemAffectedUsers(
  pool: Pool,
  projectId: string,
  range: DateRange,
  key: { method: string; path: string; statusCode: number | null },
  opts: { search?: string; limit?: number } = {}
) {
  const limit = opts.limit ?? 80;
  const params: unknown[] = [projectId, range.from, range.to, key.method, key.path];
  let statusSql = "status_code IS NULL";
  if (key.statusCode != null) {
    statusSql = "status_code = $6";
    params.push(key.statusCode);
  }
  let searchSql = "";
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    searchSql = ` AND (COALESCE(user_email,'') ILIKE $${params.length} OR COALESCE(user_id,'') ILIKE $${params.length})`;
  }
  params.push(limit);

  const resultClass = httpResultClassSql();
  const q = await pool.query<{
    user_key: string | null;
    user_id: string | null;
    email: string | null;
    errors: string;
    sessions: string;
    last_seen: Date;
    sample_session_id: string | null;
  }>(
    `SELECT COALESCE(${USER_KEY_SQL}, session_id) AS user_key,
            MAX(user_id) FILTER (WHERE user_id IS NOT NULL AND TRIM(user_id) <> '') AS user_id,
            MAX(user_email) FILTER (WHERE user_email IS NOT NULL AND TRIM(user_email) <> '') AS email,
            COUNT(*)::text AS errors,
            COUNT(DISTINCT session_id)::text AS sessions,
            MAX(occurred_at) AS last_seen,
            (ARRAY_AGG(session_id ORDER BY occurred_at DESC)
              FILTER (WHERE session_id IS NOT NULL AND TRIM(session_id) <> ''))[1] AS sample_session_id
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       AND (${resultClass}) IN ('client_failure','server_error','network')
       AND COALESCE(http_method, 'GET') = $4
       AND ${EVENT_PATH_SQL} = $5
       AND ${statusSql}
       ${searchSql}
     GROUP BY COALESCE(${USER_KEY_SQL}, session_id)
     ORDER BY COUNT(*) DESC, MAX(occurred_at) DESC
     LIMIT $${params.length}`,
    params
  );

  return {
    users: q.rows.map((r) => ({
      userKey: r.user_key ?? "",
      userId: r.user_id,
      email: r.email,
      errors: Number(r.errors),
      sessions: Number(r.sessions),
      lastSeen: r.last_seen.toISOString(),
      sampleSessionId: r.sample_session_id,
    })),
  };
}

/**
 * Full API request status board: success + failure classes, with HTTP 0 called out.
 * Used by the interactive Errors / API status explorer.
 */
export async function getApiStatusExplorer(pool: Pool, projectId: string, range: DateRange) {
  const resultClass = httpResultClassSql();
  const serviceSql = `UPPER(COALESCE(NULLIF(TRIM(service), ''), 'OTHER'))`;

  const [summaryQ, byServiceQ, byServiceClassQ, status0ByServiceQ, endpointsQ, status0Q, usersQ] =
    await Promise.all([
    pool.query<{ cls: string; n: string; users: string }>(
      `SELECT ${resultClass} AS cls,
              COUNT(*)::text AS n,
              ${IDENTIFIED_USERS_SQL}::text AS users
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY 1`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ service: string; n: string; users: string }>(
      `SELECT ${serviceSql} AS service,
              COUNT(*)::text AS n,
              ${IDENTIFIED_USERS_SQL}::text AS users
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY 1
       ORDER BY COUNT(*) DESC`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ service: string; cls: string; n: string; users: string }>(
      `SELECT ${serviceSql} AS service,
              ${resultClass} AS cls,
              COUNT(*)::text AS n,
              ${IDENTIFIED_USERS_SQL}::text AS users
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY 1, 2`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ service: string; n: string; users: string }>(
      `SELECT ${serviceSql} AS service,
              COUNT(*)::text AS n,
              ${IDENTIFIED_USERS_SQL}::text AS users
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         AND COALESCE(status_code, 0) = 0
         AND (${resultClass}) IN ('client_failure', 'server_error', 'network')
       GROUP BY 1`,
      [projectId, range.from, range.to]
    ),
    pool.query<{
      method: string | null;
      path: string;
      status_code: number | null;
      result_class: string;
      service: string;
      occurrences: string;
      users_affected: string;
      sessions_affected: string;
      first_seen: Date;
      last_seen: Date;
      avg_latency: string | null;
    }>(
      `SELECT COALESCE(http_method, 'GET') AS method,
              ${EVENT_PATH_SQL} AS path,
              status_code,
              ${resultClass} AS result_class,
              ${serviceSql} AS service,
              COUNT(*)::text AS occurrences,
              ${IDENTIFIED_USERS_SQL}::text AS users_affected,
              COUNT(DISTINCT session_id)::text AS sessions_affected,
              MIN(occurred_at) AS first_seen,
              MAX(occurred_at) AS last_seen,
              AVG(latency_ms)::text AS avg_latency
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY COALESCE(http_method, 'GET'), ${EVENT_PATH_SQL}, status_code, ${resultClass}, ${serviceSql}
       ORDER BY COUNT(*) DESC
       LIMIT 200`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ n: string; users: string }>(
      `SELECT COUNT(*)::text AS n,
              ${IDENTIFIED_USERS_SQL}::text AS users
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         AND COALESCE(status_code, 0) = 0
         AND (${resultClass}) IN ('client_failure', 'server_error', 'network')`,
      [projectId, range.from, range.to]
    ),
    // Top requesters per endpoint group (any outcome — success or failure)
    pool.query<{
      method: string | null;
      path: string;
      status_code: number | null;
      result_class: string;
      service: string;
      user_key: string | null;
      user_id: string | null;
      email: string | null;
      requests: string;
      sessions: string;
      last_seen: Date;
      sample_session_id: string | null;
      rn: string;
    }>(
      `SELECT * FROM (
         SELECT COALESCE(http_method, 'GET') AS method,
                ${EVENT_PATH_SQL} AS path,
                status_code,
                ${resultClass} AS result_class,
                ${serviceSql} AS service,
                ${USER_KEY_SQL} AS user_key,
                MAX(user_id) FILTER (WHERE user_id IS NOT NULL AND TRIM(user_id) <> '') AS user_id,
                MAX(user_email) FILTER (WHERE user_email IS NOT NULL AND TRIM(user_email) <> '') AS email,
                COUNT(*)::text AS requests,
                COUNT(DISTINCT session_id)::text AS sessions,
                MAX(occurred_at) AS last_seen,
                (ARRAY_AGG(session_id ORDER BY occurred_at DESC)
                  FILTER (WHERE session_id IS NOT NULL AND TRIM(session_id) <> ''))[1] AS sample_session_id,
                ROW_NUMBER() OVER (
                  PARTITION BY COALESCE(http_method, 'GET'), ${EVENT_PATH_SQL}, status_code,
                               ${resultClass}, ${serviceSql}
                  ORDER BY COUNT(*) DESC, MAX(occurred_at) DESC
                )::text AS rn
         FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
           AND ${USER_KEY_SQL} IS NOT NULL
         GROUP BY COALESCE(http_method, 'GET'), ${EVENT_PATH_SQL}, status_code, ${resultClass},
                  ${serviceSql}, ${USER_KEY_SQL}
       ) ranked
       WHERE rn::int <= 8`,
      [projectId, range.from, range.to]
    ),
  ]);

  const byClass = {
    success: 0,
    clientFailure: 0,
    serverError: 0,
    network: 0,
  };
  const usersByClass = {
    success: 0,
    clientFailure: 0,
    serverError: 0,
    network: 0,
  };
  for (const r of summaryQ.rows) {
    const n = Number(r.n);
    const u = Number(r.users);
    if (r.cls === "success") {
      byClass.success = n;
      usersByClass.success = u;
    } else if (r.cls === "client_failure") {
      byClass.clientFailure = n;
      usersByClass.clientFailure = u;
    } else if (r.cls === "server_error") {
      byClass.serverError = n;
      usersByClass.serverError = u;
    } else if (r.cls === "network") {
      byClass.network = n;
      usersByClass.network = u;
    }
  }

  type ServiceStat = {
    service: string;
    total: number;
    users: number;
    success: number;
    clientFailure: number;
    serverError: number;
    network: number;
    status0: number;
    status0Users: number;
    usersByClass: {
      success: number;
      clientFailure: number;
      serverError: number;
      network: number;
    };
  };

  const emptyStat = (service: string): ServiceStat => ({
    service,
    total: 0,
    users: 0,
    success: 0,
    clientFailure: 0,
    serverError: 0,
    network: 0,
    status0: 0,
    status0Users: 0,
    usersByClass: { success: 0, clientFailure: 0, serverError: 0, network: 0 },
  });

  const serviceStatsMap = new Map<string, ServiceStat>();
  for (const r of byServiceQ.rows) {
    const svc = (r.service || "OTHER").toUpperCase();
    const cur = serviceStatsMap.get(svc) ?? emptyStat(svc);
    cur.total = Number(r.n);
    cur.users = Number(r.users);
    serviceStatsMap.set(svc, cur);
  }
  for (const r of byServiceClassQ.rows) {
    const svc = (r.service || "OTHER").toUpperCase();
    const cur = serviceStatsMap.get(svc) ?? emptyStat(svc);
    const n = Number(r.n);
    const u = Number(r.users);
    if (r.cls === "success") {
      cur.success = n;
      cur.usersByClass.success = u;
    } else if (r.cls === "client_failure") {
      cur.clientFailure = n;
      cur.usersByClass.clientFailure = u;
    } else if (r.cls === "server_error") {
      cur.serverError = n;
      cur.usersByClass.serverError = u;
    } else if (r.cls === "network") {
      cur.network = n;
      cur.usersByClass.network = u;
    }
    serviceStatsMap.set(svc, cur);
  }
  for (const r of status0ByServiceQ.rows) {
    const svc = (r.service || "OTHER").toUpperCase();
    const cur = serviceStatsMap.get(svc) ?? emptyStat(svc);
    cur.status0 = Number(r.n);
    cur.status0Users = Number(r.users);
    serviceStatsMap.set(svc, cur);
  }

  const byService = [...serviceStatsMap.values()]
    .map((s) => ({ service: s.service, count: s.total, users: s.users }))
    .sort((a, b) => b.count - a.count);

  const totals = await pool.query<{ method: string | null; path: string; total: string }>(
    `SELECT COALESCE(http_method, 'GET') AS method,
            ${EVENT_PATH_SQL} AS path,
            COUNT(*)::text AS total
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
     GROUP BY 1, 2`,
    [projectId, range.from, range.to]
  );
  const totalMap = new Map(totals.rows.map((r) => [`${r.method ?? "GET"}\0${r.path}`, Number(r.total)]));

  type UserHit = {
    userKey: string;
    userId: string | null;
    email: string | null;
    requests: number;
    sessions: number;
    lastSeen: string;
    sampleSessionId: string | null;
  };
  const usersByEndpoint = new Map<string, UserHit[]>();
  for (const r of usersQ.rows) {
    const key = [
      r.method ?? "GET",
      r.path || "/",
      r.status_code ?? "",
      r.result_class,
      (r.service || "OTHER").toUpperCase(),
    ].join("\0");
    const list = usersByEndpoint.get(key) ?? [];
    list.push({
      userKey: r.user_key ?? "",
      userId: r.user_id,
      email: r.email,
      requests: Number(r.requests),
      sessions: Number(r.sessions),
      lastSeen: r.last_seen.toISOString(),
      sampleSessionId: r.sample_session_id,
    });
    usersByEndpoint.set(key, list);
  }

  const endpoints = endpointsQ.rows.map((r) => {
    const method = r.method ?? "GET";
    const occurrences = Number(r.occurrences);
    const usersAffected = Number(r.users_affected);
    const cls = (r.result_class as HttpResultClass) || "client_failure";
    const service = (r.service || "OTHER").toUpperCase();
    const total = totalMap.get(`${method}\0${r.path}`) ?? occurrences;
    const statusCode = r.status_code;
    const isStatus0 = (statusCode ?? 0) === 0;
    const userKey = [method, r.path || "/", statusCode ?? "", cls, service].join("\0");
    return {
      method,
      path: r.path || "/",
      statusCode,
      resultClass: cls,
      service,
      serviceGroup: service,
      isStatus0,
      occurrences,
      usersAffected,
      sessionsAffected: Number(r.sessions_affected),
      firstSeen: r.first_seen.toISOString(),
      lastSeen: r.last_seen.toISOString(),
      avgLatencyMs: r.avg_latency ? Math.round(Number(r.avg_latency)) : 0,
      share: total > 0 ? occurrences / total : 1,
      severity:
        cls === "success"
          ? ("low" as const)
          : problemSeverity({
              statusCode,
              occurrences,
              usersAffected,
              resultClass: cls,
            }),
      users: usersByEndpoint.get(userKey) ?? [],
    };
  });

  const upstreams = await listProjectUpstreams(pool, projectId);
  const seen = new Set(byService.map((b) => b.service));
  // Include configured upstreams even if they have 0 traffic in range
  for (const u of upstreams) {
    const slug = u.slug.toUpperCase();
    if (!seen.has(slug)) {
      seen.add(slug);
      byService.push({ service: slug, count: 0, users: 0 });
      serviceStatsMap.set(slug, emptyStat(slug));
    }
  }

  const serviceStats = Object.fromEntries(
    [...serviceStatsMap.entries()].map(([k, v]) => [k, v])
  );

  // Same source as Overview / Users so the headline user count matches.
  const allUsersQ = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT ${USER_KEY_SQL})::text AS n
     FROM user_sessions
     WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
       AND ended_at >= $2 AND started_at <= $3`,
    [projectId, range.from, range.to]
  );

  return {
    summary: {
      ...byClass,
      total: byClass.success + byClass.clientFailure + byClass.serverError + byClass.network,
      status0: Number(status0Q.rows[0]?.n ?? 0),
      status0Users: Number(status0Q.rows[0]?.users ?? 0),
      usersByClass,
      usersTotal: Number(allUsersQ.rows[0]?.n ?? 0),
      failureUsers:
        usersByClass.clientFailure + usersByClass.serverError + usersByClass.network,
    },
    byService,
    services: byService.map((b) => ({
      id: b.service,
      label: b.service,
      count: b.count,
      users: b.users,
    })),
    serviceStats,
    endpoints,
  };
}

/** Users who hit an endpoint (any status) or failures matching a class / HTTP 0 filter. */
export async function getApiStatusAffectedUsers(
  pool: Pool,
  projectId: string,
  range: DateRange,
  opts: {
    resultClass?: HttpResultClass;
    status0?: boolean;
    service?: string;
    method?: string;
    path?: string;
    statusCode?: number | null;
    /** When true (or when method+path set), include successful requests too. */
    includeSuccess?: boolean;
    search?: string;
    limit?: number;
  } = {}
) {
  const limit = opts.limit ?? 80;
  const resultClass = httpResultClassSql();
  const serviceSql = `UPPER(COALESCE(NULLIF(TRIM(service), ''), 'OTHER'))`;
  const params: unknown[] = [projectId, range.from, range.to];
  const clauses: string[] = [
    `project_id = $1`,
    `occurred_at >= $2`,
    `occurred_at <= $3`,
    `${USER_KEY_SQL} IS NOT NULL`,
  ];

  const scopedToEndpoint = Boolean(opts.method && opts.path);
  const includeSuccess = opts.includeSuccess === true || scopedToEndpoint;

  if (!includeSuccess) {
    clauses.push(`(${resultClass}) IN ('client_failure','server_error','network')`);
    if (opts.resultClass && opts.resultClass !== "success") {
      params.push(opts.resultClass);
      clauses.push(`(${resultClass}) = $${params.length}`);
    }
  } else if (opts.resultClass) {
    params.push(opts.resultClass);
    clauses.push(`(${resultClass}) = $${params.length}`);
  }

  if (opts.status0) {
    clauses.push(`COALESCE(status_code, 0) = 0`);
    if (includeSuccess && !opts.resultClass) {
      clauses.push(`(${resultClass}) IN ('client_failure','server_error','network')`);
    }
  }

  if (opts.service) {
    const svc = opts.service.toUpperCase();
    if (svc === "OTHER") {
      clauses.push(`${serviceSql} NOT IN ('MVEND', 'KORALINK')`);
    } else {
      params.push(svc);
      clauses.push(`${serviceSql} = $${params.length}`);
    }
  }

  if (opts.method && opts.path) {
    params.push(opts.method, opts.path);
    clauses.push(`COALESCE(http_method, 'GET') = $${params.length - 1}`);
    clauses.push(`${EVENT_PATH_SQL} = $${params.length}`);
    if (opts.statusCode === null) {
      clauses.push(`status_code IS NULL`);
    } else if (opts.statusCode !== undefined) {
      params.push(opts.statusCode);
      clauses.push(`status_code = $${params.length}`);
    }
  }

  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim()}%`);
    clauses.push(
      `(COALESCE(user_email,'') ILIKE $${params.length} OR COALESCE(user_id,'') ILIKE $${params.length})`
    );
  }
  params.push(limit);

  const q = await pool.query<{
    user_key: string | null;
    user_id: string | null;
    email: string | null;
    errors: string;
    sessions: string;
    last_seen: Date;
    sample_session_id: string | null;
    top_endpoint: string | null;
  }>(
    `SELECT ${USER_KEY_SQL} AS user_key,
            MAX(user_id) FILTER (WHERE user_id IS NOT NULL AND TRIM(user_id) <> '') AS user_id,
            MAX(user_email) FILTER (WHERE user_email IS NOT NULL AND TRIM(user_email) <> '') AS email,
            COUNT(*)::text AS errors,
            COUNT(DISTINCT session_id)::text AS sessions,
            MAX(occurred_at) AS last_seen,
            (ARRAY_AGG(session_id ORDER BY occurred_at DESC)
              FILTER (WHERE session_id IS NOT NULL AND TRIM(session_id) <> ''))[1] AS sample_session_id,
            (ARRAY_AGG(COALESCE(http_method,'GET') || ' ' || ${EVENT_PATH_SQL} ORDER BY occurred_at DESC))[1] AS top_endpoint
     FROM api_events
     WHERE ${clauses.join(" AND ")}
     GROUP BY ${USER_KEY_SQL}
     ORDER BY COUNT(*) DESC, MAX(occurred_at) DESC
     LIMIT $${params.length}`,
    params
  );

  return {
    users: q.rows.map((r) => ({
      userKey: r.user_key ?? "",
      userId: r.user_id,
      email: r.email,
      errors: Number(r.errors),
      requests: Number(r.errors),
      sessions: Number(r.sessions),
      lastSeen: r.last_seen.toISOString(),
      sampleSessionId: r.sample_session_id,
      topEndpoint: r.top_endpoint,
    })),
  };
}

export async function getProjectDashboard(pool: Pool, projectId: string, range: DateRange) {
  const prev = previousRange(range);
  const spanMs = range.to.getTime() - range.from.getTime();
  const hourly = spanMs <= 36 * 3600000;
  const resultClass = httpResultClassSql();
  const infraFailSql = `${resultClass} IN ('server_error', 'network')`;

  const kpi = await pool.query<{
    users: string;
    sessions: string;
    actions: string;
    apis: string;
    errors: string;
    avg_latency: string | null;
    prev_users: string;
    prev_sessions: string;
    prev_actions: string;
    prev_apis: string;
    prev_errors: string;
    prev_latency: string | null;
  }>(
    `SELECT
       (SELECT COUNT(DISTINCT ${USER_KEY_SQL})::text FROM user_sessions
         WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
           AND ended_at >= $2 AND started_at <= $3) AS users,
       (SELECT COUNT(*)::text FROM user_sessions
         WHERE project_id = $1 AND ended_at >= $2 AND started_at <= $3) AS sessions,
       (SELECT COUNT(*)::text FROM session_actions
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3) AS actions,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3) AS apis,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
           AND (${infraFailSql})) AS errors,
       (SELECT AVG(latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
           AND latency_ms IS NOT NULL) AS avg_latency,
       (SELECT COUNT(DISTINCT ${USER_KEY_SQL})::text FROM user_sessions
         WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
           AND ended_at >= $4 AND started_at <= $5) AS prev_users,
       (SELECT COUNT(*)::text FROM user_sessions
         WHERE project_id = $1 AND ended_at >= $4 AND started_at <= $5) AS prev_sessions,
       (SELECT COUNT(*)::text FROM session_actions
         WHERE project_id = $1 AND occurred_at >= $4 AND occurred_at <= $5) AS prev_actions,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $4 AND occurred_at <= $5) AS prev_apis,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $4 AND occurred_at <= $5
           AND (${infraFailSql})) AS prev_errors,
       (SELECT AVG(latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $4 AND occurred_at <= $5
           AND latency_ms IS NOT NULL) AS prev_latency`,
    [projectId, range.from, range.to, prev.from, prev.to]
  );
  const k = kpi.rows[0]!;
  const users = Number(k.users);
  const sessions = Number(k.sessions);
  const actions = Number(k.actions);
  const apis = Number(k.apis);
  const errors = Number(k.errors);
  const avgLatencyMs = k.avg_latency ? Math.round(Number(k.avg_latency)) : 0;
  const prevApis = Number(k.prev_apis);
  const prevErrors = Number(k.prev_errors);
  const availability = apis === 0 ? 1 : (apis - errors) / apis;
  const prevAvailability = prevApis === 0 ? 1 : (prevApis - prevErrors) / prevApis;
  const errorRate = apis === 0 ? 0 : errors / apis;
  const prevErrorRate = prevApis === 0 ? 0 : prevErrors / prevApis;
  const prevLatency = k.prev_latency ? Math.round(Number(k.prev_latency)) : 0;

  const activityQ = hourly
    ? await pool.query<{ label: string; n: string }>(
        `SELECT EXTRACT(HOUR FROM occurred_at)::int::text AS label, COUNT(*)::text AS n
         FROM session_actions
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY 1`,
        [projectId, range.from, range.to]
      )
    : await pool.query<{ label: string; n: string }>(
        `SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS label, COUNT(*)::text AS n
         FROM session_actions
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY 1
         ORDER BY 1`,
        [projectId, range.from, range.to]
      );

  let activity: { label: string; count: number }[];
  if (hourly) {
    const map = new Map(activityQ.rows.map((r) => [Number(r.label), Number(r.n)]));
    activity = Array.from({ length: 24 }, (_, h) => ({
      label: String(h).padStart(2, "0"),
      count: map.get(h) ?? 0,
    }));
  } else {
    activity = activityQ.rows.map((r) => ({ label: r.label, count: Number(r.n) }));
  }

  const [problems, funnels, outcomeQ, byServiceQ, byEndpointQ] = await Promise.all([
    getProjectProblems(pool, projectId, range),
    getReportFunnels(pool, projectId, range),
    pool.query<{ cls: string; n: string }>(
      `SELECT ${resultClass} AS cls, COUNT(*)::text AS n
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY 1`,
      [projectId, range.from, range.to]
    ),
    pool.query<{
      service: string;
      host: string | null;
      cls: string;
      n: string;
    }>(
      `SELECT service,
              (regexp_match(COALESCE(request_url, ''), 'https?://([^/]+)'))[1] AS host,
              ${resultClass} AS cls,
              COUNT(*)::text AS n
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY service, host, 3`,
      [projectId, range.from, range.to]
    ),
    pool.query<{
      method: string;
      path: string;
      cls: string;
      n: string;
      last_seen: Date;
    }>(
      `SELECT COALESCE(http_method, 'GET') AS method,
              ${EVENT_PATH_SQL} AS path,
              ${resultClass} AS cls,
              COUNT(*)::text AS n,
              MAX(occurred_at) AS last_seen
       FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY 1, 2, 3
       ORDER BY COUNT(*) DESC
       LIMIT 80`,
      [projectId, range.from, range.to]
    ),
  ]);

  const outcomeTotals = {
    success: 0,
    clientFailure: 0,
    serverError: 0,
    network: 0,
  };
  for (const r of outcomeQ.rows) {
    const n = Number(r.n);
    if (r.cls === "success") outcomeTotals.success += n;
    else if (r.cls === "client_failure") outcomeTotals.clientFailure += n;
    else if (r.cls === "server_error") outcomeTotals.serverError += n;
    else if (r.cls === "network") outcomeTotals.network += n;
  }

  const upstreams = await listProjectUpstreams(pool, projectId);
  type Acc = {
    service: string;
    host: string | null;
    success: number;
    clientFailure: number;
    serverError: number;
    network: number;
  };
  const serviceMap = new Map<string, Acc>();
  for (const r of byServiceQ.rows) {
    const resolved =
      (r.host ? matchUpstreamSlug(`https://${r.host}/`, upstreams) : null) ?? r.service;
    const hostNorm = r.host ? normalizeHost(r.host) : null;
    const key = `${resolved.toUpperCase()}::${hostNorm ?? ""}`;
    const cur = serviceMap.get(key) ?? {
      service: resolved.toUpperCase(),
      host: hostNorm,
      success: 0,
      clientFailure: 0,
      serverError: 0,
      network: 0,
    };
    const n = Number(r.n);
    if (r.cls === "success") cur.success += n;
    else if (r.cls === "client_failure") cur.clientFailure += n;
    else if (r.cls === "server_error") cur.serverError += n;
    else if (r.cls === "network") cur.network += n;
    serviceMap.set(key, cur);
  }
  const apiOps = [...serviceMap.values()]
    .map((a) => {
      const total = a.success + a.clientFailure + a.serverError + a.network;
      return {
        service: a.service,
        host: a.host,
        total,
        success: a.success,
        clientFailure: a.clientFailure,
        serverError: a.serverError,
        network: a.network,
        status: apiOpsStatus({
          success: a.success,
          clientFailure: a.clientFailure,
          serverError: a.serverError,
          network: a.network,
        }),
      };
    })
    .sort((a, b) => b.total - a.total);

  type EpAcc = {
    method: string;
    path: string;
    success: number;
    clientFailure: number;
    serverError: number;
    network: number;
    lastSeen: string;
  };
  const epMap = new Map<string, EpAcc>();
  for (const r of byEndpointQ.rows) {
    const key = `${r.method} ${r.path}`;
    const cur = epMap.get(key) ?? {
      method: r.method,
      path: r.path,
      success: 0,
      clientFailure: 0,
      serverError: 0,
      network: 0,
      lastSeen: r.last_seen.toISOString(),
    };
    const n = Number(r.n);
    if (r.cls === "success") cur.success += n;
    else if (r.cls === "client_failure") cur.clientFailure += n;
    else if (r.cls === "server_error") cur.serverError += n;
    else if (r.cls === "network") cur.network += n;
    if (r.last_seen.toISOString() > cur.lastSeen) cur.lastSeen = r.last_seen.toISOString();
    epMap.set(key, cur);
  }
  const apiRequests = [...epMap.values()]
    .map((e) => ({
      ...e,
      total: e.success + e.clientFailure + e.serverError + e.network,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const startStep = pickFunnelStart(funnels.steps);
  const start =
    startStep ??
    (funnels.transitions[0]
      ? { screen: funnels.transitions[0].from, sessions: funnels.transitions[0].count }
      : undefined);
  const funnel = sequentialFunnel(
    start ? { screen: start.screen, sessions: start.sessions } : undefined,
    funnels.transitions.filter((t) => !/^\(?\s*unknown\s*\)?$/i.test(t.to))
  );

  const healthStatus =
    availability >= 0.995 && errorRate <= 0.01
      ? "healthy"
      : availability >= 0.97 && errorRate <= 0.05
        ? "degraded"
        : "critical";

  return {
    hasEvents: sessions > 0 || apis > 0,
    health: {
      status: healthStatus,
      availability,
      availabilityDelta: pctDelta(availability * 100, prevAvailability * 100),
      avgLatencyMs,
      latencyDelta: pctDelta(avgLatencyMs, prevLatency),
      errorRate,
      errorRateDelta: pctDelta(errorRate * 100, prevErrorRate * 100),
    },
    kpis: {
      users,
      sessions,
      actions,
      apiRequests: apis,
      errors,
      usersDelta: pctDelta(users, Number(k.prev_users)),
      sessionsDelta: pctDelta(sessions, Number(k.prev_sessions)),
      actionsDelta: pctDelta(actions, Number(k.prev_actions)),
      apisDelta: pctDelta(apis, Number(k.prev_apis)),
      errorsDelta: pctDelta(errors, Number(k.prev_errors)),
    },
    activity,
    activityUnit: hourly ? "hour" : "day",
    apiOutcomes: outcomeTotals,
    apiOps,
    apiRequestOutcomes: apiRequests,
    topProblems: problems.errors.slice(0, 5),
    funnel,
  };
}

export async function getProjectPerformance(pool: Pool, projectId: string, range: DateRange) {
  const prev = previousRange(range);
  const spanMs = range.to.getTime() - range.from.getTime();
  const hourly = spanMs <= 36 * 3600000;

  const kpi = await pool.query<{
    avg: string | null;
    p95: string | null;
    p99: string | null;
    prev_avg: string | null;
    prev_p95: string | null;
    prev_p99: string | null;
  }>(
    `SELECT
       (SELECT AVG(latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND latency_ms IS NOT NULL) AS avg,
       (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND latency_ms IS NOT NULL) AS p95,
       (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND latency_ms IS NOT NULL) AS p99,
       (SELECT AVG(latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $4 AND occurred_at <= $5 AND latency_ms IS NOT NULL) AS prev_avg,
       (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $4 AND occurred_at <= $5 AND latency_ms IS NOT NULL) AS prev_p95,
       (SELECT percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= $4 AND occurred_at <= $5 AND latency_ms IS NOT NULL) AS prev_p99`,
    [projectId, range.from, range.to, prev.from, prev.to]
  );
  const k = kpi.rows[0]!;
  const avg = k.avg ? Math.round(Number(k.avg)) : 0;
  const p95 = k.p95 ? Math.round(Number(k.p95)) : 0;
  const p99 = k.p99 ? Math.round(Number(k.p99)) : 0;

  const endpoints = await pool.query<{
    method: string | null;
    path: string;
    total: string;
    avg_latency: string | null;
    p95: string | null;
    p99: string | null;
    max_latency: string | null;
  }>(
    `SELECT COALESCE(http_method, 'GET') AS method, ${EVENT_PATH_SQL} AS path,
            COUNT(*)::text AS total,
            AVG(latency_ms)::text AS avg_latency,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::text AS p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::text AS p99,
            MAX(latency_ms)::text AS max_latency
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND latency_ms IS NOT NULL
     GROUP BY 1, 2
     ORDER BY AVG(latency_ms) DESC NULLS LAST
     LIMIT 40`,
    [projectId, range.from, range.to]
  );

  const rows = endpoints.rows.map((r) => ({
    method: r.method ?? "GET",
    path: r.path || "/",
    total: Number(r.total),
    avgLatencyMs: r.avg_latency ? Math.round(Number(r.avg_latency)) : 0,
    p95Ms: r.p95 ? Math.round(Number(r.p95)) : 0,
    p99Ms: r.p99 ? Math.round(Number(r.p99)) : 0,
    maxLatencyMs: r.max_latency ? Math.round(Number(r.max_latency)) : 0,
  }));
  const slowApis = rows.filter((r) => r.avgLatencyMs >= 500).length;
  const prevSlow = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM (
       SELECT 1 FROM api_events
       WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND latency_ms IS NOT NULL
       GROUP BY COALESCE(http_method, 'GET'), ${EVENT_PATH_SQL}
       HAVING AVG(latency_ms) >= 500
     ) t`,
    [projectId, prev.from, prev.to]
  );

  const seriesQ = hourly
    ? await pool.query<{ label: string; avg: string | null }>(
        `SELECT EXTRACT(HOUR FROM occurred_at)::int::text AS label, AVG(latency_ms)::text AS avg
         FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND latency_ms IS NOT NULL
         GROUP BY 1`,
        [projectId, range.from, range.to]
      )
    : await pool.query<{ label: string; avg: string | null }>(
        `SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS label, AVG(latency_ms)::text AS avg
         FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3 AND latency_ms IS NOT NULL
         GROUP BY 1
         ORDER BY 1`,
        [projectId, range.from, range.to]
      );

  let latency: { label: string; avgMs: number }[];
  if (hourly) {
    const map = new Map(seriesQ.rows.map((r) => [Number(r.label), r.avg ? Math.round(Number(r.avg)) : 0]));
    latency = Array.from({ length: 24 }, (_, h) => ({
      label: String(h).padStart(2, "0"),
      avgMs: map.get(h) ?? 0,
    }));
  } else {
    latency = seriesQ.rows.map((r) => ({
      label: r.label,
      avgMs: r.avg ? Math.round(Number(r.avg)) : 0,
    }));
  }

  return {
    kpis: {
      avgLatencyMs: avg,
      avgDelta: pctDelta(avg, k.prev_avg ? Math.round(Number(k.prev_avg)) : 0),
      p95Ms: p95,
      p95Delta: pctDelta(p95, k.prev_p95 ? Math.round(Number(k.prev_p95)) : 0),
      p99Ms: p99,
      p99Delta: pctDelta(p99, k.prev_p99 ? Math.round(Number(k.prev_p99)) : 0),
      slowApis,
      slowDelta: pctDelta(slowApis, Number(prevSlow.rows[0]?.n ?? 0)),
    },
    latency,
    latencyUnit: hourly ? "hour" : "day",
    endpoints: rows,
  };
}

export async function getReportBehavior(pool: Pool, projectId: string, range: DateRange) {
  const labelA = screenLabelSql("a");
  const label = screenLabelSql();
  const screens = await pool.query<{ screen: string; views: string; users: string }>(
    `SELECT ${labelA} AS screen,
            COUNT(*)::text AS views,
            COUNT(DISTINCT COALESCE(NULLIF(TRIM(s.user_id), ''), NULLIF(TRIM(s.user_email), ''), a.session_id))::text AS users
     FROM session_actions a
     LEFT JOIN user_sessions s
       ON s.session_id = a.session_id AND s.project_id = a.project_id
     WHERE a.project_id = $1 AND ${navKindSql("a")}
       AND a.occurred_at >= $2 AND a.occurred_at <= $3
     GROUP BY 1
     ORDER BY COUNT(*) DESC
     LIMIT 12`,
    [projectId, range.from, range.to]
  );

  const nav = await pool.query<{ session_id: string; screen: string }>(
    `SELECT session_id, ${label} AS screen
     FROM session_actions
     WHERE project_id = $1 AND ${NAV_KIND_SQL}
       AND occurred_at >= $2 AND occurred_at <= $3
     ORDER BY session_id, occurred_at
     LIMIT 20000`,
    [projectId, range.from, range.to]
  );

  const bySession = new Map<string, string[]>();
  for (const r of nav.rows) {
    const list = bySession.get(r.session_id) ?? [];
    list.push(r.screen);
    bySession.set(r.session_id, list);
  }
  const journeys = rankJourneys([...bySession.values()], 8);

  return {
    screens: screens.rows.map((r) => ({
      screen: r.screen,
      views: Number(r.views),
      users: Number(r.users),
    })),
    journeys,
    sessionsSampled: bySession.size,
  };
}

export async function getFunnelReport(pool: Pool, projectId: string, range: DateRange) {
  const funnels = await getReportFunnels(pool, projectId, range);
  const start = pickFunnelStart(funnels.steps);
  const steps = sequentialFunnel(
    start ? { screen: start.screen, sessions: start.sessions } : undefined,
    funnels.transitions
  );
  const dropoff = largestDropoff(steps);
  const first = steps[0]?.users ?? 0;
  const last = steps[steps.length - 1]?.users ?? 0;
  return {
    steps,
    transitions: funnels.transitions,
    conversion: first === 0 ? 0 : last / first,
    dropoff: dropoff
      ? { ...dropoff, causes: dropoffCauses(dropoff.from, dropoff.to) }
      : null,
  };
}
