import type { Pool } from "pg";
import { config } from "../config.js";
import { SERVICES } from "../constants.js";
import {
  errorRateToDisplayStatus,
  getErrorRateLast5Minutes,
  getLastSeenIso,
} from "./slidingWindow.js";

const WINDOWS: Record<string, string> = {
  "1h": "1 hour",
  "6h": "6 hours",
  "24h": "24 hours",
  "7d": "7 days",
};

const SPARK_BUCKET_SEC: Record<string, number> = {
  "1h": 60,
  "6h": 900,
  "24h": 3600,
  "7d": 86400,
};

export type DashboardApiRow = {
  id: string;
  label: string;
  subtitle: string | null;
  status: "operational" | "degraded" | "down";
  error_rate_5m: number;
  error_rate_window: number;
  p50: number;
  p95: number;
  total_requests: number;
  success_count: number;
  failure_count: number;
  other_count: number;
  unique_users: number;
  last_seen: string | null;
  sparkline: { bucket: string; count: number }[];
};

export type DashboardPayload = {
  window: string;
  summary: {
    unique_users: number;
    unique_sessions: number;
    total_requests: number;
    success_count: number;
    failure_count: number;
    other_count: number;
    failed_sessions_24h: number;
    open_incidents: number;
  };
  services: Record<
    string,
    {
      status: string;
      error_rate_5m: number;
      last_seen: string | null;
      p50: number;
      p95: number;
      total_requests: number;
      error_rate: number;
      sparkline: { bucket: string; count: number }[];
    }
  >;
  apis: DashboardApiRow[];
};

function trackedDefinitions(): { id: string; label: string; baseUrl: string }[] {
  const u = config.trackedApiUrls;
  return [
    { id: "koralink_main", label: "Koralink main API", baseUrl: u.koralink },
    { id: "gwiza_mvend", label: "Gwiza / MVEND", baseUrl: u.gwiza },
    { id: "ddin_agency", label: "DDIN digital services", baseUrl: u.ddin },
    { id: "tickets_resolveit", label: "Tickets (ResolveIt)", baseUrl: u.tickets },
  ];
}

function hostLikePattern(baseUrl: string): string {
  try {
    return `%${new URL(baseUrl).hostname}%`;
  } catch {
    return `%${baseUrl.replace(/^https?:\/\//, "").split("/")[0]}%`;
  }
}

async function sparklineForScope(
  pool: Pool,
  interval: string,
  bucketSec: number,
  whereSql: string,
  params: unknown[]
): Promise<{ bucket: string; count: number }[]> {
  const sp = await pool.query<{ bucket: Date; c: string }>(
    `SELECT
       (timestamp with time zone 'epoch' +
         (floor(extract(epoch FROM occurred_at) / $${params.length + 1}::float8) * $${params.length + 1}::float8)
         * interval '1 second') AS bucket,
       COUNT(*)::text AS c
     FROM api_events
     WHERE occurred_at >= now() - $${params.length + 2}::interval AND ${whereSql}
     GROUP BY 1 ORDER BY 1 ASC`,
    [...params, bucketSec, interval]
  );
  return sp.rows.map((row) => ({
    bucket: row.bucket.toISOString(),
    count: Number(row.c),
  }));
}

export async function getDashboardMetrics(
  pool: Pool,
  windowId: string
): Promise<DashboardPayload> {
  const interval = WINDOWS[windowId] ?? "6 hours";
  const bucketSec = SPARK_BUCKET_SEC[windowId] ?? 900;

  const summaryR = await pool.query<{
    unique_users: string;
    unique_sessions: string;
    total: string;
    success: string;
    failure: string;
    other: string;
  }>(
    `SELECT
       COUNT(DISTINCT user_email) FILTER (WHERE user_email IS NOT NULL AND user_email <> '')::text AS unique_users,
       COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL)::text AS unique_sessions,
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::text AS success,
       COUNT(*) FILTER (WHERE outcome = 'FAILURE')::text AS failure,
       COUNT(*) FILTER (WHERE outcome = 'OTHER')::text AS other
     FROM api_events
     WHERE occurred_at >= now() - $1::interval`,
    [interval]
  );
  const s = summaryR.rows[0];

  const failedSessionsR = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM user_sessions
     WHERE failure_events > 0 AND ended_at >= now() - interval '24 hours'`
  );

  const incidentsR = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM incidents WHERE status IN ('open', 'investigating')`
  );

  const services: DashboardPayload["services"] = {};
  for (const svc of SERVICES) {
    const rate5m = await getErrorRateLast5Minutes(pool, svc);
    const status = errorRateToDisplayStatus(rate5m);
    const lastSeen = await getLastSeenIso(pool, svc);

    const agg = await pool.query<{
      p50: string;
      p95: string;
      total: string;
      er: string;
    }>(
      `SELECT
         COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p50,
         COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p95,
         COUNT(*)::text AS total,
         COALESCE(AVG(CASE WHEN outcome IN ('FAILURE', 'OTHER') THEN 1.0 ELSE 0 END), 0)::text AS er
       FROM api_events
       WHERE service = $1 AND occurred_at >= now() - $2::interval`,
      [svc, interval]
    );
    const row = agg.rows[0];
    const spark = await sparklineForScope(
      pool,
      interval,
      bucketSec,
      "service = $1",
      [svc]
    );

    services[svc] = {
      status,
      error_rate_5m: rate5m,
      last_seen: lastSeen,
      p50: Math.round(Number(row?.p50 ?? 0)),
      p95: Math.round(Number(row?.p95 ?? 0)),
      total_requests: Number(row?.total ?? 0),
      error_rate: Number(row?.er ?? 0),
      sparkline: spark,
    };
  }

  const upstreamKeysR = await pool.query<{
    upstream_key: string;
    service: string;
    total: string;
    success: string;
    failure: string;
    other: string;
    users: string;
    er: string;
    p50: string;
    p95: string;
    last_seen: Date | null;
  }>(
    `SELECT upstream_key, MIN(service) AS service,
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::text AS success,
            COUNT(*) FILTER (WHERE outcome = 'FAILURE')::text AS failure,
            COUNT(*) FILTER (WHERE outcome = 'OTHER')::text AS other,
            COUNT(DISTINCT user_email) FILTER (WHERE user_email IS NOT NULL)::text AS users,
            COALESCE(AVG(CASE WHEN outcome IN ('FAILURE', 'OTHER') THEN 1.0 ELSE 0 END), 0)::text AS er,
            COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p50,
            COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p95,
            MAX(occurred_at) AS last_seen
     FROM api_events
     WHERE occurred_at >= now() - $1::interval AND upstream_key IS NOT NULL
     GROUP BY upstream_key
     ORDER BY COUNT(*) DESC
     LIMIT 24`,
    [interval]
  );

  const apiMap = new Map<string, DashboardApiRow>();

  for (const d of trackedDefinitions()) {
    apiMap.set(d.id, {
      id: d.id,
      label: d.label,
      subtitle: d.baseUrl,
      status: "operational",
      error_rate_5m: 0,
      error_rate_window: 0,
      p50: 0,
      p95: 0,
      total_requests: 0,
      success_count: 0,
      failure_count: 0,
      other_count: 0,
      unique_users: 0,
      last_seen: null,
      sparkline: [],
    });
  }

  for (const row of upstreamKeysR.rows) {
    const er5m = await pool.query<{ er: string }>(
      `SELECT COALESCE(AVG(CASE WHEN outcome IN ('FAILURE', 'OTHER') THEN 1.0 ELSE 0 END), 0)::text AS er
       FROM api_events
       WHERE upstream_key = $1 AND occurred_at >= now() - interval '5 minutes'`,
      [row.upstream_key]
    );
    const rate5m = Number(er5m.rows[0]?.er ?? 0);
    const spark = await sparklineForScope(
      pool,
      interval,
      bucketSec,
      "upstream_key = $1",
      [row.upstream_key]
    );

    apiMap.set(row.upstream_key, {
      id: row.upstream_key,
      label: row.upstream_key,
      subtitle: row.service,
      status: errorRateToDisplayStatus(rate5m),
      error_rate_5m: rate5m,
      error_rate_window: Number(row.er),
      p50: Math.round(Number(row.p50)),
      p95: Math.round(Number(row.p95)),
      total_requests: Number(row.total),
      success_count: Number(row.success),
      failure_count: Number(row.failure),
      other_count: Number(row.other),
      unique_users: Number(row.users),
      last_seen: row.last_seen ? row.last_seen.toISOString() : null,
      sparkline: spark,
    });
  }

  for (const d of trackedDefinitions()) {
    if (apiMap.get(d.id)?.total_requests === 0) {
      const hostPat = hostLikePattern(d.baseUrl);
      const metrics = await pool.query<{
        total: string;
        success: string;
        failure: string;
        other: string;
        users: string;
        er: string;
        p50: string;
        p95: string;
        last_seen: Date | null;
      }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::text AS success,
                COUNT(*) FILTER (WHERE outcome = 'FAILURE')::text AS failure,
                COUNT(*) FILTER (WHERE outcome = 'OTHER')::text AS other,
                COUNT(DISTINCT user_email)::text AS users,
                COALESCE(AVG(CASE WHEN outcome IN ('FAILURE', 'OTHER') THEN 1.0 ELSE 0 END), 0)::text AS er,
                COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p50,
                COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms), 0)::text AS p95,
                MAX(occurred_at) AS last_seen
         FROM api_events
         WHERE occurred_at >= now() - $1::interval
           AND (upstream_key = $2 OR request_url ILIKE $3)`,
        [interval, d.id, hostPat]
      );
      const m = metrics.rows[0];
      if (m && Number(m.total) > 0) {
        const er5mR = await pool.query<{ er: string }>(
          `SELECT COALESCE(AVG(CASE WHEN outcome IN ('FAILURE', 'OTHER') THEN 1.0 ELSE 0 END), 0)::text AS er
           FROM api_events
           WHERE occurred_at >= now() - interval '5 minutes'
             AND (upstream_key = $1 OR request_url ILIKE $2)`,
          [d.id, hostPat]
        );
        const rate5m = Number(er5mR.rows[0]?.er ?? 0);
        const spark = await sparklineForScope(
          pool,
          interval,
          bucketSec,
          "(upstream_key = $1 OR request_url ILIKE $2)",
          [d.id, hostPat]
        );
        apiMap.set(d.id, {
          id: d.id,
          label: d.label,
          subtitle: d.baseUrl,
          status: errorRateToDisplayStatus(rate5m),
          error_rate_5m: rate5m,
          error_rate_window: Number(m.er),
          p50: Math.round(Number(m.p50)),
          p95: Math.round(Number(m.p95)),
          total_requests: Number(m.total),
          success_count: Number(m.success),
          failure_count: Number(m.failure),
          other_count: Number(m.other),
          unique_users: Number(m.users),
          last_seen: m.last_seen ? m.last_seen.toISOString() : null,
          sparkline: spark,
        });
      }
    }
  }

  const apis = [...apiMap.values()].sort(
    (a, b) => b.total_requests - a.total_requests
  );

  return {
    window: windowId,
    summary: {
      unique_users: Number(s?.unique_users ?? 0),
      unique_sessions: Number(s?.unique_sessions ?? 0),
      total_requests: Number(s?.total ?? 0),
      success_count: Number(s?.success ?? 0),
      failure_count: Number(s?.failure ?? 0),
      other_count: Number(s?.other ?? 0),
      failed_sessions_24h: Number(failedSessionsR.rows[0]?.c ?? 0),
      open_incidents: Number(incidentsR.rows[0]?.c ?? 0),
    },
    services,
    apis,
  };
}
