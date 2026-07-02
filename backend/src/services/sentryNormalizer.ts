import type { PersistEventInput } from "../types/persistEvent.js";
import { mapAppServiceToRollup } from "./sentryServiceMap.js";

/** Raw row from Sentry Discover API or webhook wrapper. */
export type SentryDiscoverRow = Record<string, unknown>;

const INGEST_TYPES = new Set(["api_success", "api_failure"]);
const SKIP_TYPES = new Set([
  "external_api_success",
  "external_api_failure",
]);

function tag(row: SentryDiscoverRow, key: string): string {
  const v = row[`tags[${key}]`];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function str(row: SentryDiscoverRow, key: string): string {
  const v = row[key];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export function parseHttpStatus(raw: string): { status_code: number; isOther: boolean } {
  const t = raw.trim().toUpperCase();
  if (!t || t === "PARSING_ERROR" || t === "NETWORK_ERROR" || t === "TIMEOUT") {
    return { status_code: 0, isOther: true };
  }
  const n = parseInt(t, 10);
  if (Number.isNaN(n)) return { status_code: 0, isOther: true };
  return { status_code: n, isOther: false };
}

function slugUpstreamKey(host: string, path: string): string {
  const base = `${host}_${path.replace(/^\/+/, "").replace(/[^a-zA-Z0-9]+/g, "_")}`
    .toLowerCase()
    .replace(/^_+|_+$/g, "");
  const slug = base.length > 0 ? base : "unknown";
  return slug.slice(0, 128);
}

function deriveOutcome(
  status: string,
  sentryType: string,
  statusCode: number,
  isOther: boolean
): "SUCCESS" | "FAILURE" | "OTHER" {
  if (isOther || statusCode === 0) return "OTHER";
  const st = status.toLowerCase();
  if (st === "success" || sentryType === "api_success") return "SUCCESS";
  if (statusCode >= 200 && statusCode < 300) return "SUCCESS";
  return "FAILURE";
}

/**
 * Normalize one Sentry Discover row into a monitor event, or null if skipped.
 */
export function normalizeSentryRow(row: SentryDiscoverRow): PersistEventInput | null {
  const sentryType = tag(row, "type");
  if (SKIP_TYPES.has(sentryType)) return null;
  if (sentryType && !INGEST_TYPES.has(sentryType)) {
    if (sentryType.startsWith("external_")) return null;
  }

  const requestUrl = tag(row, "endpoint");
  const sessionId = tag(row, "session_id");
  if (!requestUrl || !sessionId) {
    return null;
  }

  const sentryEventId = str(row, "id");
  if (!sentryEventId) return null;

  let pathname = requestUrl;
  let host = "";
  try {
    const u = new URL(requestUrl);
    pathname = u.pathname + (u.search || "");
    host = u.hostname;
  } catch {
    pathname = requestUrl.split("?")[0] ?? requestUrl;
  }

  const httpStatusRaw = tag(row, "http_status");
  const { status_code, isOther } = parseHttpStatus(httpStatusRaw);
  const statusTag = tag(row, "status");
  const outcome = deriveOutcome(statusTag, sentryType, status_code, isOther);

  const appService = tag(row, "service") || "unknown";
  const actionIndexRaw = tag(row, "action_index");
  const action_index = actionIndexRaw ? parseInt(actionIndexRaw, 10) : undefined;

  const timestamp = str(row, "timestamp");
  const occurred_at = timestamp
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();

  const failureReason = tag(row, "failure_reason") || undefined;
  const userId = str(row, "user.id") || undefined;
  const userEmail = str(row, "user.email") || undefined;

  return {
    service: mapAppServiceToRollup(appService),
    endpoint: pathname.slice(0, 2048),
    request_url: requestUrl.slice(0, 4096),
    status_code,
    latency_ms: 0,
    error_code: failureReason,
    source: "mobile",
    session_id: sessionId,
    occurred_at,
    upstream_key: slugUpstreamKey(host, pathname.split("?")[0] ?? ""),
    outcome,
    sentry_event_id: sentryEventId,
    app_service: appService,
    action_index: Number.isFinite(action_index) ? action_index : undefined,
    user_id: userId,
    user_email: userEmail,
    user_role: tag(row, "role") || undefined,
    account_type: tag(row, "account_type") || undefined,
    sentry_type: sentryType || undefined,
    failure_reason: failureReason,
    ingest_source: "sentry",
    response_body: undefined,
  };
}

/** Extract discover rows from webhook body shapes. */
export function extractSentryRows(body: unknown): SentryDiscoverRow[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;

  if (Array.isArray(o.data)) {
    return o.data as SentryDiscoverRow[];
  }
  if (o.event && typeof o.event === "object") {
    return [o.event as SentryDiscoverRow];
  }
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    return [o.data as SentryDiscoverRow];
  }
  if (tag(o as SentryDiscoverRow, "endpoint") || str(o, "id")) {
    return [o as SentryDiscoverRow];
  }
  const event = o.event as Record<string, unknown> | undefined;
  if (event?.tags && typeof event.tags === "object") {
    const tags = event.tags as Record<string, string>;
    const flat: SentryDiscoverRow = { id: String(event.event_id ?? event.id ?? "") };
    for (const [k, v] of Object.entries(tags)) {
      flat[`tags[${k}]`] = v;
    }
    if (event.timestamp) flat.timestamp = event.timestamp;
    return [flat];
  }
  return [];
}
