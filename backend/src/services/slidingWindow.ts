import type { Pool, PoolClient } from "pg";
import {
  RATE_DEGRADED_MIN,
  RATE_DOWN_MIN,
  type ServiceName,
} from "../constants.js";

export type DbQueryable = Pool | PoolClient;

export function isRequestError(statusCode: number): boolean {
  return statusCode >= 400;
}

export type DisplayStatus = "operational" | "degraded" | "down";

export function errorRateToDisplayStatus(errorRate: number): DisplayStatus {
  if (errorRate >= RATE_DOWN_MIN) return "down";
  if (errorRate >= RATE_DEGRADED_MIN) return "degraded";
  return "operational";
}

/** Error rate in the last 5 minutes: FAILURE + OTHER count as errors (server clock). */
export async function getErrorRateLast5Minutes(
  db: DbQueryable,
  service: ServiceName
): Promise<number> {
  const r = await db.query<{ er: string }>(
    `SELECT
      CASE
        WHEN COUNT(*)::bigint = 0 THEN 0::float8
        ELSE (COUNT(*) FILTER (WHERE outcome IN ('FAILURE', 'OTHER')))::float8
          / NULLIF(COUNT(*)::float8, 0)
      END AS er
     FROM api_events
     WHERE service = $1 AND occurred_at >= now() - interval '5 minutes'`,
    [service]
  );
  return Number(r.rows[0]?.er ?? 0);
}

export async function getErrorRateLast5MinutesForUpstream(
  db: DbQueryable,
  service: ServiceName,
  upstreamKey: string
): Promise<number> {
  const r = await db.query<{ er: string }>(
    `SELECT
      CASE
        WHEN COUNT(*)::bigint = 0 THEN 0::float8
        ELSE (COUNT(*) FILTER (WHERE outcome IN ('FAILURE', 'OTHER')))::float8
          / NULLIF(COUNT(*)::float8, 0)
      END AS er
     FROM api_events
     WHERE service = $1 AND upstream_key = $2
       AND occurred_at >= now() - interval '5 minutes'`,
    [service, upstreamKey]
  );
  return Number(r.rows[0]?.er ?? 0);
}

export async function getLastSeenIso(
  db: DbQueryable,
  service: ServiceName
): Promise<string | null> {
  const r = await db.query<{ m: Date | null }>(
    `SELECT MAX(occurred_at) AS m FROM api_events WHERE service = $1`,
    [service]
  );
  const m = r.rows[0]?.m;
  return m ? m.toISOString() : null;
}

export type ApiOutcome = "SUCCESS" | "FAILURE" | "OTHER";

export type UpstreamHealthRow = {
  service: string;
  upstream_key: string;
  status: DisplayStatus;
  error_rate_5m: number;
  last_seen: string | null;
  last_outcome: ApiOutcome | null;
};

/** One round-trip for the dashboard: all registered upstreams + live 5m rate + last call outcome. */
export async function listUpstreamHealth(
  db: DbQueryable
): Promise<UpstreamHealthRow[]> {
  const r = await db.query<{
    service: string;
    upstream_key: string;
    er: string;
    last_seen: Date | null;
    last_outcome: string | null;
  }>(
    `SELECT
      h.service,
      h.upstream_key,
      COALESCE(
        (SELECT
          CASE WHEN COUNT(*)::bigint = 0 THEN 0::float8
          ELSE (COUNT(*) FILTER (WHERE e.outcome IN ('FAILURE', 'OTHER')))::float8
            / NULLIF(COUNT(*)::float8, 0)
          END
         FROM api_events e
         WHERE e.service = h.service AND e.upstream_key = h.upstream_key
           AND e.occurred_at >= now() - interval '5 minutes'),
        0
      )::text AS er,
      (SELECT MAX(e2.occurred_at) FROM api_events e2
       WHERE e2.service = h.service AND e2.upstream_key = h.upstream_key) AS last_seen,
      (SELECT e3.outcome FROM api_events e3
       WHERE e3.service = h.service AND e3.upstream_key = h.upstream_key
       ORDER BY e3.occurred_at DESC LIMIT 1) AS last_outcome
     FROM upstream_health_state h
     ORDER BY h.service, h.upstream_key`
  );
  return r.rows.map((row) => ({
    service: row.service,
    upstream_key: row.upstream_key,
    status: errorRateToDisplayStatus(Number(row.er)),
    error_rate_5m: Number(row.er),
    last_seen: row.last_seen ? row.last_seen.toISOString() : null,
    last_outcome:
      row.last_outcome === "SUCCESS" ||
      row.last_outcome === "FAILURE" ||
      row.last_outcome === "OTHER"
        ? row.last_outcome
        : null,
  }));
}
