import type { Pool } from "pg";
import type { PersistEventInput } from "../types/persistEvent.js";
import {
  errorRateToDisplayStatus,
  getErrorRateLast5Minutes,
  getErrorRateLast5MinutesForUpstream,
} from "./slidingWindow.js";
import {
  computeSeverity,
  createIncident,
  findOpenIncident,
  updateIncidentSeverity,
} from "./incidents.js";
import { broadcastSse } from "../sse/hub.js";
import type { ServiceName } from "../constants.js";
import type { DbQueryable } from "./slidingWindow.js";
import { incidentLink, notifySlack } from "./notifications/slack.js";

async function upsertUserSession(
  client: DbQueryable,
  raw: PersistEventInput,
  occurredAt: Date
): Promise<void> {
  if (!raw.session_id) return;
  const failureInc = raw.outcome === "FAILURE" || raw.outcome === "OTHER" ? 1 : 0;

  await client.query(
    `INSERT INTO user_sessions
      (session_id, started_at, ended_at, last_action_index, user_id, user_email, role, account_type, total_events, failure_events, distinct_endpoints, updated_at)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, 1, $8, 1, now())
     ON CONFLICT (session_id) DO UPDATE SET
       started_at = LEAST(user_sessions.started_at, EXCLUDED.started_at),
       ended_at = GREATEST(user_sessions.ended_at, EXCLUDED.ended_at),
       last_action_index = GREATEST(
         COALESCE(user_sessions.last_action_index, 0),
         COALESCE(EXCLUDED.last_action_index, 0)
       ),
       user_id = COALESCE(EXCLUDED.user_id, user_sessions.user_id),
       user_email = COALESCE(EXCLUDED.user_email, user_sessions.user_email),
       role = COALESCE(EXCLUDED.role, user_sessions.role),
       account_type = COALESCE(EXCLUDED.account_type, user_sessions.account_type),
       total_events = user_sessions.total_events + 1,
       failure_events = user_sessions.failure_events + $8,
       updated_at = now()`,
    [
      raw.session_id,
      occurredAt.toISOString(),
      raw.action_index ?? null,
      raw.user_id ?? null,
      raw.user_email ?? null,
      raw.user_role ?? null,
      raw.account_type ?? null,
      failureInc,
    ]
  );

  await client.query(
    `UPDATE user_sessions SET distinct_endpoints = (
       SELECT COUNT(DISTINCT COALESCE(request_url, endpoint))::int
       FROM api_events WHERE session_id = $1
     )
     WHERE session_id = $1`,
    [raw.session_id]
  );
}

export async function persistAndProcessEvent(
  pool: Pool,
  raw: PersistEventInput
): Promise<void> {
  const occurredAt = new Date(raw.occurred_at);
  const client = await pool.connect();

  let incidentBroadcast:
    | {
        kind: "opened" | "updated";
        id: string;
        service: string;
        severity: string;
        title: string;
      }
    | undefined;
  let statusChanged = false;
  let upstreamStatusChanged = false;
  let errorRate = 0;
  let display: ReturnType<typeof errorRateToDisplayStatus> = "operational";
  let upstreamRate = 0;
  let upstreamDisplay: ReturnType<typeof errorRateToDisplayStatus> =
    "operational";
  let inserted = false;

  try {
    await client.query("BEGIN");

    if (raw.sentry_event_id) {
      const dup = await client.query<{ id: string }>(
        `SELECT id::text FROM api_events WHERE sentry_event_id = $1`,
        [raw.sentry_event_id]
      );
      if (dup.rows.length > 0) {
        await client.query("COMMIT");
        return;
      }
    }

    const insertResult = await client.query<{ id: string }>(
      `INSERT INTO api_events
        (service, endpoint, request_url, status_code, latency_ms, error_code, source, session_id, occurred_at, response_body, upstream_key, outcome,
         sentry_event_id, app_service, action_index, user_id, user_email, user_role, account_type, sentry_type, failure_reason, ingest_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id::text`,
      [
        raw.service,
        raw.endpoint,
        raw.request_url ?? null,
        raw.status_code,
        raw.latency_ms,
        raw.error_code ?? null,
        raw.source,
        raw.session_id ?? null,
        occurredAt.toISOString(),
        raw.response_body ?? null,
        raw.upstream_key,
        raw.outcome,
        raw.sentry_event_id ?? null,
        raw.app_service ?? null,
        raw.action_index ?? null,
        raw.user_id ?? null,
        raw.user_email ?? null,
        raw.user_role ?? null,
        raw.account_type ?? null,
        raw.sentry_type ?? null,
        raw.failure_reason ?? null,
        raw.ingest_source ?? "direct",
      ]
    );
    inserted = insertResult.rows.length > 0;
    if (!inserted) {
      await client.query("COMMIT");
      return;
    }

    await upsertUserSession(client, raw, occurredAt);

    errorRate = await getErrorRateLast5Minutes(client, raw.service);
    display = errorRateToDisplayStatus(errorRate);

    upstreamRate = await getErrorRateLast5MinutesForUpstream(
      client,
      raw.service,
      raw.upstream_key
    );
    upstreamDisplay = errorRateToDisplayStatus(upstreamRate);

    const prevRow = await client.query<{ prev_display_status: string }>(
      `SELECT prev_display_status FROM service_health_state WHERE service = $1 FOR UPDATE`,
      [raw.service]
    );
    const p = prevRow.rows[0]?.prev_display_status;
    const prev: "operational" | "degraded" | "down" =
      p === "degraded" || p === "down" ? p : "operational";

    await client.query(
      `UPDATE service_health_state
       SET prev_display_status = $2, updated_at = now()
       WHERE service = $1`,
      [raw.service, display]
    );

    await client.query(
      `INSERT INTO upstream_health_state (service, upstream_key, prev_display_status, updated_at)
       VALUES ($1, $2, 'operational', now())
       ON CONFLICT (service, upstream_key) DO NOTHING`,
      [raw.service, raw.upstream_key]
    );

    const prevUpRow = await client.query<{ prev_display_status: string }>(
      `SELECT prev_display_status FROM upstream_health_state
       WHERE service = $1 AND upstream_key = $2 FOR UPDATE`,
      [raw.service, raw.upstream_key]
    );
    const pu = prevUpRow.rows[0]?.prev_display_status;
    const prevUp: "operational" | "degraded" | "down" =
      pu === "degraded" || pu === "down" ? pu : "operational";

    await client.query(
      `UPDATE upstream_health_state
       SET prev_display_status = $3, updated_at = now()
       WHERE service = $1 AND upstream_key = $2`,
      [raw.service, raw.upstream_key, upstreamDisplay]
    );

    if (upstreamDisplay !== prevUp) {
      upstreamStatusChanged = true;
    }

    if (display !== prev) {
      statusChanged = true;
      incidentBroadcast = await collectIncidentSideEffects(
        client,
        raw.service,
        prev,
        display,
        errorRate
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  if (!statusChanged && !upstreamStatusChanged) {
    return;
  }

  if (incidentBroadcast) {
    if (incidentBroadcast.kind === "opened") {
      broadcastSse("incident_opened", {
        id: incidentBroadcast.id,
        service: incidentBroadcast.service,
        severity: incidentBroadcast.severity,
        title: incidentBroadcast.title,
      });
      void notifySlack(
        `:rotating_light: *${incidentBroadcast.severity}* — ${incidentBroadcast.title}\n${incidentLink(incidentBroadcast.id)}`
      );
    } else {
      broadcastSse("incident_updated", {
        id: incidentBroadcast.id,
        service: incidentBroadcast.service,
        severity: incidentBroadcast.severity,
        title: incidentBroadcast.title,
      });
      void notifySlack(
        `:arrow_up: *${incidentBroadcast.severity}* (escalated) — ${incidentBroadcast.title}\n${incidentLink(incidentBroadcast.id)}`
      );
    }
  }

  if (statusChanged) {
    broadcastSse("service_status", {
      service: raw.service,
      status: display,
      error_rate_5m: errorRate,
      at: new Date().toISOString(),
    });
  }

  if (upstreamStatusChanged) {
    broadcastSse("upstream_status", {
      service: raw.service,
      upstream_key: raw.upstream_key,
      status: upstreamDisplay,
      error_rate_5m: upstreamRate,
      at: new Date().toISOString(),
    });
  }
}

async function collectIncidentSideEffects(
  pool: DbQueryable,
  service: ServiceName,
  prev: "operational" | "degraded" | "down",
  next: "operational" | "degraded" | "down",
  errorRate: number
): Promise<
  | {
      kind: "opened" | "updated";
      id: string;
      service: string;
      severity: string;
      title: string;
    }
  | undefined
> {
  const severity = computeSeverity(errorRate, next);
  const title = `${service} ${next === "down" ? "down" : "degraded"} — ${(errorRate * 100).toFixed(1)}% errors (5m window)`;

  if (next === "operational") {
    return undefined;
  }

  const open = await findOpenIncident(pool, service);

  if (!open) {
    const id = await createIncident(pool, {
      service,
      title,
      severity,
      triggerErrorRate: errorRate,
    });
    return { kind: "opened", id, service, severity, title };
  }

  if (next === "down" && prev === "degraded") {
    await updateIncidentSeverity(pool, open.id, severity, errorRate, title);
    return { kind: "updated", id: open.id, service, severity, title };
  }

  return undefined;
}
