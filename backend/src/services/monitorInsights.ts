import type { Pool } from "pg";
import type { DateRange } from "./monitorJourney.js";
import { getReportFunnels, previousRange, pctDelta } from "./monitorReports.js";

const USER_KEY_SQL = `COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''))`;

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
}): ProblemSeverity {
  const code = opts.statusCode ?? 0;
  if (code >= 500 && (opts.occurrences >= 80 || opts.usersAffected >= 30)) return "critical";
  if (code >= 500 || opts.occurrences >= 40) return "high";
  if (code >= 400 || opts.occurrences >= 10) return "medium";
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
  return encodeURIComponent(`${method}::${path}::${statusCode ?? ""}`);
}

export function parseProblemKey(raw: string): { method: string; path: string; statusCode: number | null } {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
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
  const q = await pool.query<{
    method: string | null;
    path: string;
    status_code: number | null;
    failure_reason: string | null;
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
            COUNT(*)::text AS occurrences,
            COUNT(DISTINCT COALESCE(${USER_KEY_SQL}, session_id))::text AS users_affected,
            COUNT(DISTINCT session_id)::text AS sessions_affected,
            MIN(occurred_at) AS first_seen,
            MAX(occurred_at) AS last_seen,
            AVG(latency_ms)::text AS avg_latency
     FROM api_events
     WHERE project_id = $1
       AND occurred_at >= $2 AND occurred_at <= $3
       AND outcome IN ('FAILURE', 'OTHER')
     GROUP BY COALESCE(http_method, 'GET'), ${EVENT_PATH_SQL}, status_code
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
    const severity = problemSeverity({
      statusCode: r.status_code,
      occurrences,
      usersAffected,
    });
    return {
      method,
      path: r.path || "/",
      statusCode: r.status_code,
      failureReason: r.failure_reason,
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
      errors5xx: summary.errors5xx,
      errors5xxDelta: pctDelta(summary.errors5xx, prevSummary.errors5xx),
      critical: priority.critical,
      usersInRange: totalUsers,
    },
    priority,
    errors,
    slow,
  };
}

async function problemSummaryStats(pool: Pool, projectId: string, range: DateRange) {
  const q = await pool.query<{ errors: string; users: string; errors5xx: string }>(
    `SELECT
       COUNT(*)::text AS errors,
       COUNT(DISTINCT COALESCE(${USER_KEY_SQL}, session_id))::text AS users,
       COUNT(*) FILTER (WHERE status_code >= 500)::text AS errors5xx
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       AND outcome IN ('FAILURE','OTHER')`,
    [projectId, range.from, range.to]
  );
  const r = q.rows[0]!;
  return {
    errors: Number(r.errors),
    users: Number(r.users),
    errors5xx: Number(r.errors5xx),
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
            COUNT(DISTINCT COALESCE(${USER_KEY_SQL}, session_id))::text AS users_affected,
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
       AND outcome IN ('FAILURE','OTHER')
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
       AND outcome IN ('FAILURE','OTHER')
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
  const severity = problemSeverity({
    statusCode: key.statusCode,
    occurrences,
    usersAffected,
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

  const q = await pool.query<{
    user_key: string | null;
    user_id: string | null;
    email: string | null;
    errors: string;
    sessions: string;
    last_seen: Date;
  }>(
    `SELECT COALESCE(${USER_KEY_SQL}, session_id) AS user_key,
            MAX(user_id) FILTER (WHERE user_id IS NOT NULL AND TRIM(user_id) <> '') AS user_id,
            MAX(user_email) FILTER (WHERE user_email IS NOT NULL AND TRIM(user_email) <> '') AS email,
            COUNT(*)::text AS errors,
            COUNT(DISTINCT session_id)::text AS sessions,
            MAX(occurred_at) AS last_seen
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
       AND outcome IN ('FAILURE','OTHER')
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
    })),
  };
}

export async function getProjectDashboard(pool: Pool, projectId: string, range: DateRange) {
  const prev = previousRange(range);
  const spanMs = range.to.getTime() - range.from.getTime();
  const hourly = spanMs <= 36 * 3600000;

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
           AND outcome IN ('FAILURE','OTHER')) AS errors,
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
           AND outcome IN ('FAILURE','OTHER')) AS prev_errors,
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

  const [problems, funnels] = await Promise.all([
    getProjectProblems(pool, projectId, range),
    getReportFunnels(pool, projectId, range),
  ]);

  const start =
    funnels.steps[0] ??
    (funnels.transitions[0]
      ? { screen: funnels.transitions[0].from, sessions: funnels.transitions[0].count }
      : undefined);
  const funnel = sequentialFunnel(
    start ? { screen: start.screen, sessions: start.sessions } : undefined,
    funnels.transitions
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
  const screens = await pool.query<{ screen: string; views: string; users: string }>(
    `SELECT COALESCE(NULLIF(a.screen, ''), a.from_screen, '(unknown)') AS screen,
            COUNT(*)::text AS views,
            COUNT(DISTINCT COALESCE(NULLIF(TRIM(s.user_id), ''), NULLIF(TRIM(s.user_email), ''), a.session_id))::text AS users
     FROM session_actions a
     LEFT JOIN user_sessions s
       ON s.session_id = a.session_id AND s.project_id = a.project_id
     WHERE a.project_id = $1 AND a.kind = 'navigation'
       AND a.occurred_at >= $2 AND a.occurred_at <= $3
     GROUP BY 1
     ORDER BY COUNT(*) DESC
     LIMIT 12`,
    [projectId, range.from, range.to]
  );

  const nav = await pool.query<{ session_id: string; screen: string }>(
    `SELECT session_id, COALESCE(NULLIF(screen, ''), '(unknown)') AS screen
     FROM session_actions
     WHERE project_id = $1 AND kind = 'navigation'
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
  const start = funnels.steps[0];
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
