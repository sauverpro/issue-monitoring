import type { PersistEventInput } from "../types/persistEvent.js";

export type JourneyKind = "navigation" | "lifecycle" | "auth";

export type JourneyActionInput = {
  session_id: string;
  occurred_at: string;
  sentry_event_id?: string;
  kind: JourneyKind;
  message: string;
  screen?: string;
  from_screen?: string;
  payload?: Record<string, unknown>;
};

export type BreadcrumbEnrichment = {
  http_status?: string;
  session_id?: string;
  duration_ms?: number;
  service?: string;
  endpoint?: string;
  response_body?: string;
};

type Breadcrumb = {
  category?: string;
  message?: string;
  level?: string;
  timestamp?: number | string;
  data?: Record<string, unknown>;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function dataStr(data: Record<string, unknown> | undefined, key: string): string {
  if (!data) return "";
  const v = data[key];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** Sentry timestamps may be unix seconds, millis, or ISO strings. */
export function breadcrumbTimestamp(raw: number | string | undefined, fallback: Date): Date {
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw === "number") {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? fallback : d;
  }
  const asNum = Number(raw);
  if (!Number.isNaN(asNum) && raw.trim() !== "") {
    return breadcrumbTimestamp(asNum, fallback);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export function extractBreadcrumbs(event: unknown): Breadcrumb[] {
  const o = asRecord(event);
  if (!o) return [];

  const out: Breadcrumb[] = [];

  const direct = asRecord(o.breadcrumbs);
  const directValues = direct?.values;
  if (Array.isArray(directValues)) {
    for (const b of directValues) {
      const r = asRecord(b);
      if (r) out.push(r as Breadcrumb);
    }
  } else if (Array.isArray(o.breadcrumbs)) {
    for (const b of o.breadcrumbs) {
      const r = asRecord(b);
      if (r) out.push(r as Breadcrumb);
    }
  }

  const entries = o.entries;
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      const e = asRecord(entry);
      if (!e) continue;
      if (String(e.type ?? "") !== "breadcrumbs") continue;
      const data = asRecord(e.data);
      const values = data?.values;
      if (!Array.isArray(values)) continue;
      for (const b of values) {
        const r = asRecord(b);
        if (r) out.push(r as Breadcrumb);
      }
    }
  }

  return out;
}

function classifyJourney(b: Breadcrumb): JourneyKind | null {
  const cat = (b.category ?? "").toLowerCase();
  const msg = (b.message ?? "").trim();
  const msgL = msg.toLowerCase();
  const data = b.data;

  if (cat === "navigation" || msgL.startsWith("navigation:") || msgL.includes("viewed screen")) {
    return "navigation";
  }
  if (
    msgL.includes("app became active") ||
    msgL.includes("app went to background") ||
    msgL.includes("app went to foreground")
  ) {
    return "lifecycle";
  }
  if (
    msgL.includes("user_session_bound") ||
    msgL.includes("user authentication") ||
    cat === "auth"
  ) {
    return "auth";
  }
  if (cat === "user" && dataStr(data, "session_id") && !msgL.startsWith("api ")) {
    if (msgL.includes("session")) return "auth";
  }
  return null;
}

export function journeyActionsFromBreadcrumbs(
  event: unknown,
  fallbackSessionId: string,
  eventId?: string
): JourneyActionInput[] {
  const breadcrumbs = extractBreadcrumbs(event);
  const fallbackTs = new Date();
  const actions: JourneyActionInput[] = [];

  for (const b of breadcrumbs) {
    const kind = classifyJourney(b);
    if (!kind) continue;
    const data = b.data ?? {};
    const sessionId =
      dataStr(data, "session_id") ||
      dataStr(data, "sessionId") ||
      fallbackSessionId;
    if (!sessionId) continue;

    const occurred = breadcrumbTimestamp(b.timestamp, fallbackTs);
    const screen =
      dataStr(data, "toScreen") ||
      dataStr(data, "screenName") ||
      dataStr(data, "current_screen") ||
      undefined;
    const fromScreen =
      dataStr(data, "fromScreen") ||
      dataStr(data, "previousScreen") ||
      undefined;

    actions.push({
      session_id: sessionId,
      occurred_at: occurred.toISOString(),
      sentry_event_id: eventId,
      kind,
      message: (b.message ?? kind).trim() || kind,
      screen,
      from_screen: fromScreen,
      payload: { category: b.category, ...data },
    });
  }

  return actions;
}

/**
 * Pull HTTP status / session / duration from "API … failed|success" breadcrumbs
 * matching the request URL when possible.
 */
export function enrichmentFromBreadcrumbs(
  event: unknown,
  requestUrl?: string
): BreadcrumbEnrichment {
  const breadcrumbs = extractBreadcrumbs(event);
  const url = (requestUrl ?? "").toLowerCase();
  let best: BreadcrumbEnrichment = {};

  for (const b of breadcrumbs) {
    const cat = (b.category ?? "").toLowerCase();
    const msg = (b.message ?? "").toLowerCase();
    const data = b.data ?? {};
    const endpoint = dataStr(data, "endpoint");
    const isHttp =
      cat === "http" ||
      msg.startsWith("api ") ||
      Boolean(dataStr(data, "http_status"));
    if (!isHttp) continue;

    const matchesUrl =
      !url ||
      !endpoint ||
      url.includes(endpoint.toLowerCase()) ||
      endpoint.toLowerCase().includes(url.replace(/^https?:\/\//, ""));

    const candidate: BreadcrumbEnrichment = {
      http_status: dataStr(data, "http_status") || undefined,
      session_id: dataStr(data, "session_id") || dataStr(data, "sessionId") || undefined,
      duration_ms: Number(data.duration_ms) || undefined,
      service: dataStr(data, "service") || undefined,
      endpoint: endpoint || undefined,
      response_body:
        typeof data.response_body === "string"
          ? data.response_body
          : data.response
            ? JSON.stringify(data.response)
            : undefined,
    };

    if (matchesUrl && (candidate.http_status || candidate.session_id)) {
      best = { ...best, ...candidate };
      if (url && endpoint && matchesUrl && candidate.http_status) {
        return best;
      }
    } else if (!best.session_id && candidate.session_id) {
      best = { ...best, session_id: candidate.session_id };
    }
  }

  return best;
}

export function applyEnrichment(
  event: PersistEventInput,
  extra: BreadcrumbEnrichment
): PersistEventInput {
  const httpRaw = extra.http_status;
  let status_code = event.status_code;
  let outcome = event.outcome;
  let error_code = event.error_code;
  let failure_reason = event.failure_reason;

  if (httpRaw) {
    const upper = httpRaw.toUpperCase();
    if (["FETCH_ERROR", "NETWORK_ERROR", "TIMEOUT", "PARSING_ERROR"].includes(upper)) {
      status_code = 0;
      outcome = "OTHER";
      error_code = error_code || upper;
      failure_reason = failure_reason || upper;
    } else {
      const n = parseInt(httpRaw, 10);
      if (!Number.isNaN(n)) {
        status_code = n;
        if (n >= 200 && n < 300) outcome = "SUCCESS";
        else if (n >= 400) outcome = "FAILURE";
        error_code = error_code || String(n);
        failure_reason = failure_reason || String(n);
      }
    }
  }

  const latency =
    extra.duration_ms && extra.duration_ms > 0
      ? Math.round(extra.duration_ms)
      : event.latency_ms;

  return {
    ...event,
    status_code,
    outcome,
    error_code,
    failure_reason,
    latency_ms: latency,
    session_id: extra.session_id || event.session_id,
    app_service: extra.service || event.app_service,
    request_url: extra.endpoint || event.request_url,
    response_body: extra.response_body || event.response_body,
  };
}
