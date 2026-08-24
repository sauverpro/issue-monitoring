import type { PersistEventInput } from "../types/persistEvent.js";
import { mapEventToService, mapUrlToService } from "./sentryServiceMap.js";

/** Raw row from Sentry Discover API, spans dataset, or webhook wrapper. */
export type SentryDiscoverRow = Record<string, unknown>;

const INGEST_TYPES = new Set([
  "api_success",
  "api_failure",
  "payment_success",
  "payment_failure",
]);
const SKIP_TYPES = new Set([
  "external_api_success",
  "external_api_failure",
]);

const NETWORK_STATUSES = new Set([
  "FETCH_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "PARSING_ERROR",
]);

const MAX_RESPONSE_BODY_CHARS = 131072;

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

function hash32(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function deriveSessionId(
  row: SentryDiscoverRow,
  userId: string,
  userEmail: string,
  occurredAt: Date,
  eventId: string
): string {
  const direct = [
    tag(row, "session_id"),
    tag(row, "session"),
    str(row, "session.id"),
    str(row, "contexts.trace.trace_id"),
  ].find((v) => v.length > 0);
  if (direct) return direct;

  const userKey = userId || userEmail;
  if (userKey) {
    const bucketMs = 30 * 60 * 1000;
    const bucket = Math.floor(occurredAt.getTime() / bucketMs);
    return `usr_${hash32(userKey)}_${bucket}`;
  }

  return `evt_${eventId}`;
}

export function parseHttpStatus(raw: string): { status_code: number; isOther: boolean } {
  const t = raw.trim().toUpperCase();
  if (!t || NETWORK_STATUSES.has(t)) {
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

export function clipResponseBody(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (!text || text === "[Filtered]" || text === "undefined") return undefined;
  return text.slice(0, MAX_RESPONSE_BODY_CHARS);
}

export function parseHttpDescription(raw: string): { method: string; url: string } {
  const t = raw.trim();
  const m = t.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  if (m) return { method: m[1]!.toUpperCase(), url: m[2]!.trim() };
  return { method: "", url: t };
}

export function isHttpClientSpan(row: SentryDiscoverRow): boolean {
  const op = str(row, "span.op") || str(row, "transaction.op") || tag(row, "transaction.op");
  return op.toLowerCase() === "http.client";
}

function parseLatencyMs(row: SentryDiscoverRow): number {
  const candidates = [
    row["span.duration"],
    row["span.self_time"],
    tag(row, "duration_ms"),
    tag(row, "latency_ms"),
    row["measurements.stall_count"] === undefined ? undefined : undefined,
  ];
  for (const c of candidates) {
    if (c === null || c === undefined || c === "") continue;
    const n = Number(c);
    if (Number.isFinite(n) && n >= 0) return Math.round(n);
  }
  return 0;
}

function extractResponseBody(row: SentryDiscoverRow): string | undefined {
  return clipResponseBody(
    row.response_body ??
      tag(row, "response_body") ??
      row["http.response.body"] ??
      row["contexts.http.response_body"]
  );
}

function parseUrlParts(requestUrl: string): { pathname: string; host: string } {
  try {
    const u = new URL(requestUrl);
    return { pathname: u.pathname + (u.search || ""), host: u.hostname };
  } catch {
    return { pathname: requestUrl.split("?")[0] ?? requestUrl, host: "" };
  }
}

function deriveTaggedOutcome(
  status: string,
  sentryType: string,
  statusCode: number,
  isOther: boolean,
  httpStatusRaw: string
): "SUCCESS" | "FAILURE" | "OTHER" {
  const net = httpStatusRaw.trim().toUpperCase();
  if (NETWORK_STATUSES.has(net)) return "OTHER";
  const st = status.toLowerCase();
  if (sentryType === "api_success" || sentryType === "payment_success" || st === "success") {
    return "SUCCESS";
  }
  if (sentryType === "api_failure" || sentryType === "payment_failure" || st === "failure") {
    return "FAILURE";
  }
  if (isOther || statusCode === 0) return "OTHER";
  if (statusCode >= 200 && statusCode < 300) return "SUCCESS";
  return "FAILURE";
}

export function deriveSpanOutcome(
  spanStatus: string,
  httpStatusRaw: string,
  statusCode: number,
  isOther: boolean
): "SUCCESS" | "FAILURE" | "OTHER" {
  const net = httpStatusRaw.trim().toUpperCase();
  if (NETWORK_STATUSES.has(net)) return "OTHER";
  if (statusCode >= 400) return "FAILURE";
  if (statusCode >= 200 && statusCode < 300) return "SUCCESS";

  const ss = spanStatus.trim().toLowerCase();
  if (ss === "ok" || ss === "success") return "SUCCESS";
  if (
    ss === "internal_error" ||
    ss === "unauthenticated" ||
    ss === "unknown" ||
    ss === "cancelled" ||
    ss === "invalid_argument" ||
    ss === "permission_denied" ||
    ss === "unauthenticated" ||
    ss === "error"
  ) {
    return "FAILURE";
  }
  if (isOther || statusCode === 0) return "OTHER";
  return "FAILURE";
}

function normalizeTaggedEvent(row: SentryDiscoverRow): PersistEventInput | null {
  const sentryType = tag(row, "type");
  const requestUrlTag = tag(row, "endpoint");
  const sentryEventId = str(row, "id");
  if (!sentryEventId) return null;

  const parsed = parseHttpDescription(
    requestUrlTag || str(row, "transaction") || str(row, "title")
  );
  const requestUrl =
    parsed.url ||
    requestUrlTag ||
    str(row, "transaction") ||
    str(row, "title") ||
    `/sentry/${(str(row, "project.name") || "event").toLowerCase()}`;

  const { pathname, host } = parseUrlParts(requestUrl);
  const httpStatusRaw = tag(row, "http_status");
  const { status_code, isOther } = parseHttpStatus(httpStatusRaw);
  const statusTag = tag(row, "status");
  const outcome = deriveTaggedOutcome(
    statusTag,
    sentryType,
    status_code,
    isOther,
    httpStatusRaw
  );

  const appService = tag(row, "service") || str(row, "project.name") || "unknown";
  const actionIndexRaw = tag(row, "action_index");
  const action_index = actionIndexRaw ? parseInt(actionIndexRaw, 10) : undefined;

  const timestamp = str(row, "timestamp");
  const occurredDate = timestamp ? new Date(timestamp) : new Date();
  const occurred_at = occurredDate.toISOString();

  const failureReason =
    tag(row, "failure_reason") ||
    (NETWORK_STATUSES.has(httpStatusRaw.toUpperCase()) ? httpStatusRaw.toUpperCase() : undefined);
  const userId = str(row, "user.id") || tag(row, "user_id") || undefined;
  const userEmail = str(row, "user.email") || undefined;
  const sessionId = deriveSessionId(
    row,
    userId ?? "",
    userEmail ?? "",
    occurredDate,
    sentryEventId
  );
  const method =
    tag(row, "method") || str(row, "http.request.method") || parsed.method || undefined;
  const screen = tag(row, "current_screen") || str(row, "current_screen") || undefined;

  return {
    service: mapEventToService(appService, requestUrl),
    endpoint: pathname.slice(0, 2048),
    request_url: requestUrl.slice(0, 4096),
    status_code,
    latency_ms: parseLatencyMs(row),
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
    response_body: extractResponseBody(row),
    http_method: method || undefined,
    current_screen: screen || undefined,
  };
}

export function normalizeHttpSpan(row: SentryDiscoverRow): PersistEventInput | null {
  const description =
    str(row, "span.description") ||
    str(row, "span.name") ||
    str(row, "transaction") ||
    str(row, "title") ||
    str(row, "normalized_description");
  if (!description) return null;

  const parsed = parseHttpDescription(description);
  const method =
    str(row, "http.request.method") ||
    str(row, "span.action") ||
    tag(row, "method") ||
    parsed.method ||
    "GET";
  const requestUrl = parsed.url || description;
  const mapped = mapUrlToService(requestUrl);
  if (!mapped) return null;

  const spanId =
    str(row, "span_id") ||
    str(row, "span.id") ||
    str(row, "transaction.span_id") ||
    str(row, "id");
  const txnEventId = str(row, "transaction.event_id") || str(row, "id");
  const sentryEventId = spanId ? `span:${spanId}` : txnEventId ? `span:${txnEventId}` : "";
  if (!sentryEventId) return null;

  const { pathname, host } = parseUrlParts(requestUrl);
  const httpStatusRaw =
    tag(row, "http_status") || str(row, "http.status_code") || str(row, "span.status");
  const spanStatus = str(row, "span.status") || str(row, "trace.status") || "";
  const { status_code, isOther } = parseHttpStatus(
    NETWORK_STATUSES.has(httpStatusRaw.toUpperCase()) || /^\d+$/.test(httpStatusRaw)
      ? httpStatusRaw
      : ""
  );
  const outcome = deriveSpanOutcome(spanStatus, httpStatusRaw, status_code, isOther);

  const timestamp = str(row, "timestamp");
  const occurredDate = timestamp ? new Date(timestamp) : new Date();
  const userId = str(row, "user.id") || tag(row, "user_id") || undefined;
  const userEmail = str(row, "user.email") || undefined;
  const appService = tag(row, "service") || mapped.toLowerCase();
  const failureReason =
    (NETWORK_STATUSES.has(httpStatusRaw.toUpperCase()) ? httpStatusRaw.toUpperCase() : undefined) ||
    (outcome === "FAILURE" ? spanStatus || "internal_error" : undefined);

  return {
    service: mapped,
    endpoint: pathname.slice(0, 2048) || "/",
    request_url: requestUrl.slice(0, 4096),
    status_code,
    latency_ms: parseLatencyMs(row),
    error_code: failureReason,
    source: "mobile",
    session_id: deriveSessionId(row, userId ?? "", userEmail ?? "", occurredDate, sentryEventId),
    occurred_at: occurredDate.toISOString(),
    upstream_key: slugUpstreamKey(host, pathname.split("?")[0] ?? ""),
    outcome,
    sentry_event_id: sentryEventId,
    app_service: appService,
    user_id: userId,
    user_email: userEmail,
    user_role: tag(row, "role") || str(row, "role") || undefined,
    account_type: tag(row, "account_type") || str(row, "account_type") || undefined,
    sentry_type: "http.client",
    failure_reason: failureReason,
    ingest_source: "sentry",
    response_body: extractResponseBody(row),
    http_method: method,
    current_screen: tag(row, "current_screen") || str(row, "current_screen") || undefined,
  };
}

/**
 * Normalize one Sentry Discover / span row into a monitor event, or null if skipped.
 */
export function normalizeSentryRow(row: SentryDiscoverRow): PersistEventInput | null {
  const sentryType = tag(row, "type");
  if (SKIP_TYPES.has(sentryType)) return null;
  if (INGEST_TYPES.has(sentryType)) return normalizeTaggedEvent(row);
  if (isHttpClientSpan(row)) return normalizeHttpSpan(row);
  return null;
}

/** Extract discover rows from webhook body shapes. */
export function extractSentryRows(body: unknown): SentryDiscoverRow[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;

  if (Array.isArray(o.data)) {
    return o.data as SentryDiscoverRow[];
  }
  if (o.event && typeof o.event === "object") {
    return [flattenWebhookEvent(o.event as Record<string, unknown>)];
  }
  if (o.data && typeof o.data === "object" && !Array.isArray(o.data)) {
    return [o.data as SentryDiscoverRow];
  }
  if (tag(o as SentryDiscoverRow, "endpoint") || str(o, "id") || isHttpClientSpan(o)) {
    return [o as SentryDiscoverRow];
  }
  const event = o.event as Record<string, unknown> | undefined;
  if (event?.tags && typeof event.tags === "object") {
    return [flattenWebhookEvent(event)];
  }
  return [];
}

function flattenWebhookEvent(event: Record<string, unknown>): SentryDiscoverRow {
  const flat: SentryDiscoverRow = {
    id: String(event.event_id ?? event.id ?? ""),
    ...event,
  };
  const tags = event.tags;
  if (tags && typeof tags === "object" && !Array.isArray(tags)) {
    for (const [k, v] of Object.entries(tags as Record<string, unknown>)) {
      flat[`tags[${k}]`] = v;
    }
  }
  if (Array.isArray(tags)) {
    for (const t of tags) {
      if (Array.isArray(t) && t.length >= 2) {
        flat[`tags[${String(t[0])}]`] = t[1];
      } else if (t && typeof t === "object" && "key" in (t as object)) {
        const rec = t as { key?: string; value?: unknown };
        if (rec.key) flat[`tags[${rec.key}]`] = rec.value;
      }
    }
  }
  if (event.timestamp) flat.timestamp = event.timestamp;
  const contexts = event.contexts as Record<string, unknown> | undefined;
  const trace = contexts?.trace as Record<string, unknown> | undefined;
  if (trace?.op) flat["span.op"] = trace.op;
  if (trace?.status) flat["span.status"] = trace.status;
  if (event.transaction) flat.transaction = event.transaction;
  return flat;
}
