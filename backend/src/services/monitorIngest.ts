import type { Pool } from "pg";
import type { PersistEventInput } from "../types/persistEvent.js";
import { deriveOutcome, type MonitorEnvelope, type MonitorEvent } from "../schemas/monitorIngest.js";
import { clipAndRedactBody, sanitizePgText, sanitizePgTextOpt } from "./redactBodies.js";
import {
  classifyNetworkFailure,
  extractHost,
  matchUpstreamSlug,
  slugUpstreamKey,
} from "./monitorHosts.js";
import { persistAndProcessEvent } from "./processEvent.js";
import { persistSessionActions } from "./sessionActions.js";
import { listProjectUpstreams } from "./tenancy.js";
import { publishLiveEvent } from "../sse/liveHub.js";
import { classifyHttpResult } from "./httpResultClass.js";
import type { ResolvedProjectKey } from "./apiKeys.js";

export type IngestResult = {
  accepted: number;
  dropped: number;
};

async function touchSession(
  pool: Pool,
  envelope: MonitorEnvelope,
  projectId: string,
  occurredAt: string
): Promise<void> {
  const ctx = envelope.context;
  const sess = envelope.session;
  await pool.query(
    `INSERT INTO user_sessions
       (session_id, started_at, ended_at, last_action_index, user_id, user_email, role, account_type,
        total_events, failure_events, distinct_endpoints, updated_at,
        project_id, platform, os, app_version, network)
     VALUES ($1, $2, $2, 0, $3, $4, $5, $6, 0, 0, 0, now(), $7, $8, $9, $10, $11)
     ON CONFLICT (session_id) DO UPDATE SET
       started_at = LEAST(user_sessions.started_at, EXCLUDED.started_at),
       ended_at = GREATEST(user_sessions.ended_at, EXCLUDED.ended_at),
       user_id = COALESCE(EXCLUDED.user_id, user_sessions.user_id),
       user_email = COALESCE(EXCLUDED.user_email, user_sessions.user_email),
       role = COALESCE(EXCLUDED.role, user_sessions.role),
       account_type = COALESCE(EXCLUDED.account_type, user_sessions.account_type),
       project_id = COALESCE(EXCLUDED.project_id, user_sessions.project_id),
       platform = COALESCE(EXCLUDED.platform, user_sessions.platform),
       os = COALESCE(EXCLUDED.os, user_sessions.os),
       app_version = COALESCE(EXCLUDED.app_version, user_sessions.app_version),
       network = COALESCE(EXCLUDED.network, user_sessions.network),
       updated_at = now()`,
    [
      sanitizePgText(sess.id),
      occurredAt,
      sanitizePgTextOpt(sess.user_id) ?? null,
      sanitizePgTextOpt(sess.email) ?? null,
      sanitizePgTextOpt(sess.role) ?? null,
      sanitizePgTextOpt(sess.account_type) ?? null,
      projectId,
      sanitizePgTextOpt(ctx?.platform) ?? null,
      sanitizePgTextOpt(ctx?.os) ?? null,
      sanitizePgTextOpt(ctx?.app_version) ?? null,
      sanitizePgTextOpt(ctx?.network) ?? null,
    ]
  );
}

type JourneyEvent = Exclude<MonitorEvent, { kind: "api" }>;

function describeJourneyEvent(
  ev: JourneyEvent,
  contextScreen: string | undefined
): { message: string; screen?: string; fromScreen?: string; extra: Record<string, unknown> } {
  switch (ev.kind) {
    case "navigation":
      return {
        message: ev.message || (ev.screen ? `Opened ${ev.screen}` : "Screen view"),
        screen: ev.screen,
        fromScreen: ev.from_screen,
        extra: {},
      };
    case "lifecycle":
      return { message: ev.message, screen: contextScreen, extra: {} };
    case "auth":
      return { message: ev.message || "Session bound", screen: contextScreen, extra: {} };
    case "click":
      return { message: ev.label, screen: ev.screen, extra: { target: ev.target, label: ev.label } };
    case "system":
      return { message: ev.message || "System", screen: contextScreen, extra: {} };
    case "screen_view":
      return {
        message: `Viewed ${ev.screen}`,
        screen: ev.screen,
        fromScreen: ev.from_screen,
        extra: {},
      };
    case "form_start":
      return { message: `Started ${ev.form}`, screen: ev.screen ?? contextScreen, extra: { form: ev.form } };
    case "form_submit":
      return {
        message: `Submitted ${ev.form}`,
        screen: ev.screen ?? contextScreen,
        extra: { form: ev.form, success: ev.success },
      };
    case "search":
      return {
        message: `Searched "${ev.query}"`,
        screen: ev.screen ?? contextScreen,
        extra: { query: ev.query, results_count: ev.results_count },
      };
    case "filter":
      return {
        message: ev.value ? `Filtered ${ev.filter}: ${ev.value}` : `Filtered ${ev.filter}`,
        screen: ev.screen ?? contextScreen,
        extra: { filter: ev.filter, value: ev.value },
      };
    case "modal_open":
      return { message: `Opened ${ev.modal}`, screen: ev.screen ?? contextScreen, extra: { modal: ev.modal } };
    case "modal_close":
      return { message: `Closed ${ev.modal}`, screen: ev.screen ?? contextScreen, extra: { modal: ev.modal } };
    case "download":
      return { message: `Downloaded ${ev.file}`, screen: ev.screen ?? contextScreen, extra: { file: ev.file } };
    case "file_upload":
      return {
        message: `Uploaded ${ev.file}`,
        screen: ev.screen ?? contextScreen,
        extra: { file: ev.file, size_bytes: ev.size_bytes },
      };
    case "purchase_start":
      return {
        message: ev.item ? `Started purchase: ${ev.item}` : "Started purchase",
        screen: ev.screen ?? contextScreen,
        extra: { item: ev.item, amount: ev.amount, currency: ev.currency },
      };
    case "purchase_complete":
      return {
        message: ev.item ? `Purchase complete: ${ev.item}` : "Purchase complete",
        screen: ev.screen ?? contextScreen,
        extra: { item: ev.item, amount: ev.amount, currency: ev.currency, order_id: ev.order_id },
      };
    case "logout":
      return { message: "Logged out", screen: ev.screen ?? contextScreen, extra: {} };
  }
}

/** Same precedence as the dashboards' user key: user id, then email, then session. */
function liveUserKey(envelope: MonitorEnvelope): string {
  const s = envelope.session;
  return (s.user_id && String(s.user_id).trim()) || (s.email && s.email.trim()) || s.id;
}

export async function ingestMonitorEnvelope(
  pool: Pool,
  project: ResolvedProjectKey,
  envelope: MonitorEnvelope
): Promise<IngestResult> {
  const upstreams = await listProjectUpstreams(pool, project.projectId);
  const source = envelope.context?.source ?? "mobile";
  let accepted = 0;
  let dropped = 0;

  const firstTs = envelope.events[0]?.occurred_at ?? envelope.sent_at;
  await touchSession(pool, envelope, project.projectId, firstTs);

  for (const ev of envelope.events) {
    const actionIndex = ev.action_index ?? 0;
    const eventId = `sdk:${project.projectId}:${envelope.session.id}:${actionIndex}:${ev.kind}`;

    if (ev.kind === "api") {
      const service = matchUpstreamSlug(ev.request_url, upstreams) ?? "CUSTOM";
      const host = extractHost(ev.request_url) ?? "unknown";
      let pathname = ev.request_url;
      try {
        pathname = new URL(ev.request_url).pathname;
      } catch {
        /* keep */
      }
      const outcome = deriveOutcome(ev.status_code, ev.outcome);
      const failure = classifyNetworkFailure(ev.failure_reason);
      const payload: PersistEventInput = {
        service,
        endpoint: pathname.slice(0, 2048) || "/",
        request_url: ev.request_url,
        status_code: ev.status_code,
        latency_ms: ev.latency_ms,
        error_code: failure,
        source,
        session_id: envelope.session.id,
        occurred_at: ev.occurred_at,
        request_body: clipAndRedactBody(ev.request_body),
        response_body: clipAndRedactBody(ev.response_body),
        upstream_key: slugUpstreamKey(host, pathname),
        outcome,
        sentry_event_id: eventId,
        app_service: service,
        action_index: actionIndex,
        user_id: envelope.session.user_id,
        user_email: envelope.session.email,
        user_role: envelope.session.role,
        account_type: envelope.session.account_type,
        sentry_type: "http.client",
        failure_reason: failure ?? ev.failure_reason,
        ingest_source: "sdk",
        http_method: ev.http_method?.toUpperCase(),
        current_screen: ev.current_screen ?? envelope.context?.screen,
        project_id: project.projectId,
        platform: envelope.context?.platform,
        os: envelope.context?.os,
        app_version: envelope.context?.app_version,
        network: envelope.context?.network,
      };
      try {
        await persistAndProcessEvent(pool, payload);
        accepted += 1;
        publishLiveEvent(project.projectId, {
          id: eventId,
          kind: "api",
          at: ev.occurred_at,
          sessionId: envelope.session.id,
          userKey: liveUserKey(envelope),
          email: envelope.session.email ?? null,
          userId: envelope.session.user_id ?? null,
          service,
          method: payload.http_method ?? "GET",
          path: payload.endpoint,
          status: ev.status_code ?? null,
          latencyMs: ev.latency_ms ?? null,
          result: classifyHttpResult(ev.status_code, outcome),
          screen: payload.current_screen ?? null,
          platform: envelope.context?.platform ?? null,
          appVersion: envelope.context?.app_version ?? null,
        });
      } catch (err) {
        dropped += 1;
        console.error("[ingest/v1] api event dropped", eventId, err);
      }
      continue;
    }

    const journeyKind = ev.kind === "system" ? "lifecycle" : ev.kind;
    const described = describeJourneyEvent(ev, envelope.context?.screen);

    try {
      const n = await persistSessionActions(pool, [
        {
          session_id: envelope.session.id,
          occurred_at: ev.occurred_at,
          sentry_event_id: eventId,
          kind: journeyKind,
          message: described.message,
          screen: described.screen,
          from_screen: described.fromScreen,
          payload: {
            kind: ev.kind,
            action_index: actionIndex,
            user: envelope.session,
            context: envelope.context,
            ...described.extra,
          },
          project_id: project.projectId,
        },
      ]);
      accepted += n > 0 ? 1 : 0;
      if (n === 0) dropped += 1;
      else {
        publishLiveEvent(project.projectId, {
          id: eventId,
          kind: journeyKind,
          at: ev.occurred_at,
          sessionId: envelope.session.id,
          userKey: liveUserKey(envelope),
          email: envelope.session.email ?? null,
          userId: envelope.session.user_id ?? null,
          screen: described.screen ?? null,
          fromScreen: described.fromScreen ?? null,
          message: described.message,
          platform: envelope.context?.platform ?? null,
          appVersion: envelope.context?.app_version ?? null,
        });
        await pool.query(
          `UPDATE user_sessions SET
             ended_at = GREATEST(ended_at, $2::timestamptz),
             last_action_index = GREATEST(COALESCE(last_action_index, 0), $3),
             total_events = total_events + 1,
             updated_at = now()
           WHERE session_id = $1`,
          [sanitizePgText(envelope.session.id), ev.occurred_at, actionIndex]
        );
      }
    } catch (err) {
      dropped += 1;
      console.error("[ingest/v1] journey event dropped", eventId, err);
    }
  }

  return { accepted, dropped };
}
