import type { Pool } from "pg";
import { parseDateRange, type DateRange } from "./monitorJourney.js";

const USER_KEY_SQL = `COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''))`;

export function previousRange(range: DateRange): DateRange {
  const duration = Math.max(range.to.getTime() - range.from.getTime(), 24 * 60 * 60 * 1000);
  const to = new Date(range.from.getTime() - 1);
  const from = new Date(to.getTime() - duration);
  return { from, to };
}

export function enumerateUtcDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  while (cur <= end) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function pctDelta(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

export function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
}

function pathFromUrl(url: string | null): string {
  if (!url) return "/";
  try {
    if (url.startsWith("http")) return new URL(url).pathname || "/";
  } catch {
    /* ignore */
  }
  return (url.replace(/^https?:\/\/[^/?#]+/i, "").split("?")[0] || url).slice(0, 240) || "/";
}

function fill<T extends { date: string }>(
  days: string[],
  rows: T[],
  empty: (date: string) => T
): T[] {
  const map = new Map(rows.map((r) => [r.date, r]));
  return days.map((date) => map.get(date) ?? empty(date));
}

export type ReportKpi = {
  value: number;
  previous: number;
  delta: number | null;
  sparkline: number[];
};

export async function getReportOverview(pool: Pool, projectId: string, range: DateRange) {
  const prev = previousRange(range);
  const days = enumerateUtcDays(range.from, range.to);

  const kpi = await pool.query<{
    users: string;
    sessions: string;
    actions: string;
    apis: string;
    errors: string;
    avg_latency: string | null;
    avg_duration: string | null;
    prev_users: string;
    prev_sessions: string;
    prev_actions: string;
    prev_apis: string;
    prev_errors: string;
    prev_latency: string | null;
    prev_duration: string | null;
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
       (SELECT AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))::text FROM user_sessions
         WHERE project_id = $1 AND ended_at >= $2 AND started_at <= $3) AS avg_duration,
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
           AND latency_ms IS NOT NULL) AS prev_latency,
       (SELECT AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))::text FROM user_sessions
         WHERE project_id = $1 AND ended_at >= $4 AND started_at <= $5) AS prev_duration`,
    [projectId, range.from, range.to, prev.from, prev.to]
  );
  const k = kpi.rows[0]!;

  const [sessionDaily, actionDaily, apiDaily, kinds, screens, apis, errorTypes, users] =
    await Promise.all([
      pool.query<{ date: string; sessions: string; users: string; duration: string | null }>(
        `SELECT (started_at AT TIME ZONE 'UTC')::date::text AS date,
                COUNT(*)::text AS sessions,
                COUNT(DISTINCT ${USER_KEY_SQL})::text AS users,
                AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))::text AS duration
         FROM user_sessions
         WHERE project_id = $1 AND started_at >= $2 AND started_at <= $3
         GROUP BY 1`,
        [projectId, range.from, range.to]
      ),
      pool.query<{ date: string; n: string }>(
        `SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS date, COUNT(*)::text AS n
         FROM session_actions
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY 1`,
        [projectId, range.from, range.to]
      ),
      pool.query<{ date: string; apis: string; errors: string; latency: string | null }>(
        `SELECT (occurred_at AT TIME ZONE 'UTC')::date::text AS date,
                COUNT(*)::text AS apis,
                COUNT(*) FILTER (WHERE outcome IN ('FAILURE','OTHER'))::text AS errors,
                AVG(latency_ms)::text AS latency
         FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY 1`,
        [projectId, range.from, range.to]
      ),
      pool.query<{ kind: string; n: string }>(
        `SELECT kind, COUNT(*)::text AS n
         FROM session_actions
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY kind`,
        [projectId, range.from, range.to]
      ),
      pool.query<{ screen: string; n: string }>(
        `SELECT COALESCE(NULLIF(screen, ''), from_screen, '(unknown)') AS screen,
                COUNT(*)::text AS n
         FROM session_actions
         WHERE project_id = $1 AND kind = 'navigation' AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY 1
         ORDER BY COUNT(*) DESC
         LIMIT 8`,
        [projectId, range.from, range.to]
      ),
      pool.query<{
        method: string | null;
        request_url: string | null;
        endpoint: string | null;
        total: string;
        failure: string;
        avg_latency: string | null;
      }>(
        `SELECT COALESCE(http_method, 'GET') AS method, request_url, endpoint,
                COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE outcome IN ('FAILURE','OTHER'))::text AS failure,
                AVG(latency_ms)::text AS avg_latency
         FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY 1, 2, 3
         ORDER BY COUNT(*) DESC
         LIMIT 8`,
        [projectId, range.from, range.to]
      ),
      pool.query<{ bucket: string; n: string }>(
        `SELECT CASE
                  WHEN status_code >= 500 THEN '5xx'
                  WHEN status_code >= 400 THEN '4xx'
                  WHEN COALESCE(failure_reason, '') ILIKE '%timeout%' THEN 'timeout'
                  WHEN outcome = 'OTHER' THEN 'network'
                  ELSE 'other'
                END AS bucket,
                COUNT(*)::text AS n
         FROM api_events
         WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3
           AND outcome IN ('FAILURE','OTHER')
         GROUP BY 1
         ORDER BY COUNT(*) DESC`,
        [projectId, range.from, range.to]
      ),
      pool.query<{
        user_key: string;
        user_id: string | null;
        email: string | null;
        sessions: string;
        actions: string;
        errors: string;
      }>(
        `SELECT ${USER_KEY_SQL} AS user_key,
                MAX(user_id) FILTER (WHERE user_id IS NOT NULL AND TRIM(user_id) <> '') AS user_id,
                MAX(user_email) FILTER (WHERE user_email IS NOT NULL AND TRIM(user_email) <> '') AS email,
                COUNT(*)::text AS sessions,
                COALESCE(SUM(total_events), 0)::text AS actions,
                COALESCE(SUM(failure_events), 0)::text AS errors
         FROM user_sessions
         WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
           AND ended_at >= $2 AND started_at <= $3
         GROUP BY ${USER_KEY_SQL}
         ORDER BY SUM(total_events) DESC NULLS LAST
         LIMIT 8`,
        [projectId, range.from, range.to]
      ),
    ]);

  const daily = fill(
    days,
    days.map((date) => {
      const s = sessionDaily.rows.find((r) => r.date === date);
      const a = actionDaily.rows.find((r) => r.date === date);
      const api = apiDaily.rows.find((r) => r.date === date);
      return {
        date,
        users: Number(s?.users ?? 0),
        sessions: Number(s?.sessions ?? 0),
        durationMs: s?.duration ? Math.round(Number(s.duration) * 1000) : 0,
        actions: Number(a?.n ?? 0),
        apiRequests: Number(api?.apis ?? 0),
        errors: Number(api?.errors ?? 0),
        avgLatencyMs: api?.latency ? Math.round(Number(api.latency)) : 0,
      };
    }),
    (date) => ({
      date,
      users: 0,
      sessions: 0,
      durationMs: 0,
      actions: 0,
      apiRequests: 0,
      errors: 0,
      avgLatencyMs: 0,
    })
  );

  const apiCount = Number(k.apis);
  const kindRows = kinds.rows.map((r) => ({
    kind: r.kind,
    count: Number(r.n),
  }));
  const apiKind = { kind: "api", count: apiCount };
  const actionsByType = [...kindRows.filter((r) => r.kind !== "api"), apiKind]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);

  const screenTotal = screens.rows.reduce((s, r) => s + Number(r.n), 0) || 1;

  function toKpi(value: number, previous: number, spark: number[]): ReportKpi {
    return { value, previous, delta: pctDelta(value, previous), sparkline: spark };
  }

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    previous: { from: prev.from.toISOString(), to: prev.to.toISOString() },
    hasEvents: Number(k.sessions) > 0 || apiCount > 0,
    kpis: {
      users: toKpi(Number(k.users), Number(k.prev_users), daily.map((d) => d.users)),
      sessions: toKpi(Number(k.sessions), Number(k.prev_sessions), daily.map((d) => d.sessions)),
      actions: toKpi(Number(k.actions), Number(k.prev_actions), daily.map((d) => d.actions)),
      apiRequests: toKpi(apiCount, Number(k.prev_apis), daily.map((d) => d.apiRequests)),
      errors: toKpi(Number(k.errors), Number(k.prev_errors), daily.map((d) => d.errors)),
      avgLatencyMs: toKpi(
        k.avg_latency ? Math.round(Number(k.avg_latency)) : 0,
        k.prev_latency ? Math.round(Number(k.prev_latency)) : 0,
        daily.map((d) => d.avgLatencyMs)
      ),
      avgDurationMs: toKpi(
        k.avg_duration ? Math.round(Number(k.avg_duration) * 1000) : 0,
        k.prev_duration ? Math.round(Number(k.prev_duration) * 1000) : 0,
        daily.map((d) => d.durationMs)
      ),
    },
    daily,
    actionsByType,
    topScreens: screens.rows.map((r) => ({
      screen: r.screen,
      count: Number(r.n),
      pct: Number(r.n) / screenTotal,
    })),
    topApis: apis.rows.map((r) => {
      const total = Number(r.total);
      const failure = Number(r.failure);
      return {
        method: r.method ?? "GET",
        path: pathFromUrl(r.request_url ?? r.endpoint),
        requests: total,
        avgLatencyMs: r.avg_latency ? Math.round(Number(r.avg_latency)) : 0,
        errorRate: total === 0 ? 0 : failure / total,
      };
    }),
    errorsByType: errorTypes.rows.map((r) => ({ type: r.bucket, count: Number(r.n) })),
    topUsers: users.rows.map((r) => ({
      userKey: r.user_key,
      userId: r.user_id,
      email: r.email,
      sessions: Number(r.sessions),
      actions: Number(r.actions),
      errors: Number(r.errors),
    })),
  };
}

export async function getReportFunnels(pool: Pool, projectId: string, range: DateRange) {
  const [entry, transitions, screens] = await Promise.all([
    pool.query<{ screen: string; n: string }>(
      `SELECT COALESCE(NULLIF(screen, ''), '(unknown)') AS screen,
              COUNT(DISTINCT session_id)::text AS n
       FROM session_actions
       WHERE project_id = $1 AND kind = 'navigation'
         AND occurred_at >= $2 AND occurred_at <= $3
         AND (from_screen IS NULL OR TRIM(from_screen) = '')
       GROUP BY 1
       ORDER BY COUNT(DISTINCT session_id) DESC
       LIMIT 6`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ from_screen: string; screen: string; n: string }>(
      `SELECT COALESCE(NULLIF(from_screen, ''), '(start)') AS from_screen,
              COALESCE(NULLIF(screen, ''), '(unknown)') AS screen,
              COUNT(*)::text AS n
       FROM session_actions
       WHERE project_id = $1 AND kind = 'navigation'
         AND occurred_at >= $2 AND occurred_at <= $3
         AND from_screen IS NOT NULL AND TRIM(from_screen) <> ''
       GROUP BY 1, 2
       ORDER BY COUNT(*) DESC
       LIMIT 20`,
      [projectId, range.from, range.to]
    ),
    pool.query<{ screen: string; n: string }>(
      `SELECT COALESCE(NULLIF(screen, ''), '(unknown)') AS screen,
              COUNT(DISTINCT session_id)::text AS n
       FROM session_actions
       WHERE project_id = $1 AND kind = 'navigation'
         AND occurred_at >= $2 AND occurred_at <= $3
       GROUP BY 1
       ORDER BY COUNT(DISTINCT session_id) DESC
       LIMIT 8`,
      [projectId, range.from, range.to]
    ),
  ]);

  const totalSessions = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM user_sessions
     WHERE project_id = $1 AND ended_at >= $2 AND started_at <= $3`,
    [projectId, range.from, range.to]
  );
  const sessions = Number(totalSessions.rows[0]?.n ?? 0) || 1;
  const start = Number(entry.rows[0]?.n ?? screens.rows[0]?.n ?? 0) || sessions;

  const steps =
    entry.rows.length > 0
      ? entry.rows.map((r) => ({
          screen: r.screen,
          sessions: Number(r.n),
          conversion: Number(r.n) / start,
        }))
      : screens.rows.map((r) => ({
          screen: r.screen,
          sessions: Number(r.n),
          conversion: Number(r.n) / sessions,
        }));

  return {
    steps,
    transitions: transitions.rows.map((r) => ({
      from: r.from_screen,
      to: r.screen,
      count: Number(r.n),
    })),
  };
}

export function retentionFromPairs(
  pairs: { userKey: string; date: string }[],
  days: string[]
): { date: string; users: number; returned1d: number; returned7d: number; rate1d: number; rate7d: number }[] {
  const byDay = new Map<string, Set<string>>();
  for (const p of pairs) {
    const set = byDay.get(p.date) ?? new Set();
    set.add(p.userKey);
    byDay.set(p.date, set);
  }
  function shift(date: string, n: number): string {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  return days.map((date) => {
    const users = byDay.get(date) ?? new Set();
    const d1 = byDay.get(shift(date, 1)) ?? new Set();
    const d7 = byDay.get(shift(date, 7)) ?? new Set();
    let returned1d = 0;
    let returned7d = 0;
    for (const u of users) {
      if (d1.has(u)) returned1d += 1;
      if (d7.has(u)) returned7d += 1;
    }
    const n = users.size;
    return {
      date,
      users: n,
      returned1d,
      returned7d,
      rate1d: n === 0 ? 0 : returned1d / n,
      rate7d: n === 0 ? 0 : returned7d / n,
    };
  });
}

export async function getReportRetention(pool: Pool, projectId: string, range: DateRange) {
  const days = enumerateUtcDays(range.from, range.to);
  const end = new Date(range.to.getTime() + 8 * 24 * 60 * 60 * 1000);
  const q = await pool.query<{ user_key: string; date: string }>(
    `SELECT ${USER_KEY_SQL} AS user_key,
            (started_at AT TIME ZONE 'UTC')::date::text AS date
     FROM user_sessions
     WHERE project_id = $1 AND ${USER_KEY_SQL} IS NOT NULL
       AND started_at >= $2 AND started_at <= $3
     GROUP BY 1, 2`,
    [projectId, range.from, end]
  );
  return { days: retentionFromPairs(q.rows.map((r) => ({ userKey: r.user_key, date: r.date })), days) };
}

export async function exportReportCsv(
  pool: Pool,
  projectId: string,
  range: DateRange,
  dataset: string
): Promise<{ filename: string; csv: string }> {
  const stamp = range.from.toISOString().slice(0, 10);
  if (dataset === "daily" || dataset === "overview") {
    const overview = await getReportOverview(pool, projectId, range);
    return {
      filename: `report-daily-${stamp}.csv`,
      csv: toCsv(
        ["date", "users", "sessions", "actions", "api_requests", "errors", "avg_latency_ms", "avg_duration_ms"],
        overview.daily.map((d) => [
          d.date,
          d.users,
          d.sessions,
          d.actions,
          d.apiRequests,
          d.errors,
          d.avgLatencyMs,
          d.durationMs,
        ])
      ),
    };
  }
  if (dataset === "users") {
    const overview = await getReportOverview(pool, projectId, range);
    return {
      filename: `report-users-${stamp}.csv`,
      csv: toCsv(
        ["user", "user_id", "email", "sessions", "actions", "errors"],
        overview.topUsers.map((u) => [u.userKey, u.userId, u.email, u.sessions, u.actions, u.errors])
      ),
    };
  }
  if (dataset === "screens") {
    const overview = await getReportOverview(pool, projectId, range);
    return {
      filename: `report-screens-${stamp}.csv`,
      csv: toCsv(
        ["screen", "views", "share"],
        overview.topScreens.map((s) => [s.screen, s.count, s.pct])
      ),
    };
  }
  if (dataset === "apis") {
    const overview = await getReportOverview(pool, projectId, range);
    return {
      filename: `report-apis-${stamp}.csv`,
      csv: toCsv(
        ["method", "path", "requests", "avg_latency_ms", "error_rate"],
        overview.topApis.map((a) => [a.method, a.path, a.requests, a.avgLatencyMs, a.errorRate])
      ),
    };
  }
  if (dataset === "errors") {
    const overview = await getReportOverview(pool, projectId, range);
    return {
      filename: `report-errors-${stamp}.csv`,
      csv: toCsv(
        ["type", "count"],
        overview.errorsByType.map((e) => [e.type, e.count])
      ),
    };
  }
  if (dataset === "funnels") {
    const funnels = await getReportFunnels(pool, projectId, range);
    return {
      filename: `report-funnels-${stamp}.csv`,
      csv: toCsv(
        ["from", "to", "count"],
        funnels.transitions.map((t) => [t.from, t.to, t.count])
      ),
    };
  }
  if (dataset === "retention") {
    const ret = await getReportRetention(pool, projectId, range);
    return {
      filename: `report-retention-${stamp}.csv`,
      csv: toCsv(
        ["date", "users", "returned_1d", "rate_1d", "returned_7d", "rate_7d"],
        ret.days.map((d) => [d.date, d.users, d.returned1d, d.rate1d, d.returned7d, d.rate7d])
      ),
    };
  }
  throw new Error("Unknown dataset");
}

export function reportQueryRange(query: {
  from?: unknown;
  to?: unknown;
  days?: unknown;
}): DateRange {
  if (typeof query.from === "string" || typeof query.to === "string") {
    return parseDateRange({
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
    });
  }
  return parseDateRange({ days: Number(query.days) || 7 });
}
