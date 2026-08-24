import { config } from "../../config.js";
import { SENTRY_DISCOVER_FIELDS, SENTRY_SPAN_FIELDS, SENTRY_SPAN_QUERY } from "./discoverFields.js";
import type { SessionAction } from "../../types/sessionInvestigation.js";
import {
  journeyActionsFromBreadcrumbs,
  type JourneyActionInput,
} from "../sentryBreadcrumbs.js";

export type SentryDiscoverRow = Record<string, unknown>;

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

export function rowToSessionAction(row: SentryDiscoverRow): SessionAction | null {
  const sentryType = tag(row, "type");
  if (SKIP_TYPES.has(sentryType)) return null;

  const sessionId = tag(row, "session_id");
  if (!sessionId) return null;

  const actionIndexRaw = tag(row, "action_index");
  const actionIndex = actionIndexRaw ? parseInt(actionIndexRaw, 10) : 0;
  const endpoint = tag(row, "endpoint") || str(row, "transaction") || null;
  const method = tag(row, "method") || str(row, "http.request.method") || null;

  return {
    id: str(row, "id"),
    timestamp: str(row, "timestamp"),
    message: str(row, "message") || null,
    type: sentryType || null,
    status: tag(row, "status") || null,
    actionType: tag(row, "action_type") || "api_call",
    service: tag(row, "service") || null,
    method,
    endpoint,
    httpStatus: tag(row, "http_status") || null,
    actionIndex: Number.isFinite(actionIndex) ? actionIndex : 0,
    orderId: tag(row, "order_id") || null,
    failureReason: tag(row, "failure_reason") || null,
    role: tag(row, "role") || null,
    accountType: tag(row, "account_type") || null,
    screen: tag(row, "current_screen") || str(row, "current_screen") || null,
    latencyMs: Number(tag(row, "duration_ms") || str(row, "span.duration")) || null,
    responseBody: null,
  };
}

export function journeyToSessionAction(
  a: JourneyActionInput,
  index: number
): SessionAction {
  return {
    id: `journey:${a.kind}:${a.occurred_at}:${a.message}`,
    timestamp: a.occurred_at,
    message: a.message,
    type: a.kind,
    status: a.kind === "auth" ? "success" : "info",
    actionType: a.kind,
    service: null,
    method: null,
    endpoint: a.screen ?? a.from_screen ?? null,
    httpStatus: null,
    actionIndex: index,
    orderId: null,
    failureReason: null,
    role: typeof a.payload?.role === "string" ? a.payload.role : null,
    accountType: typeof a.payload?.account_type === "string" ? a.payload.account_type : null,
    screen: a.screen ?? null,
    latencyMs: null,
    responseBody: null,
  };
}

export function sortActionsByIndex(actions: SessionAction[]): SessionAction[] {
  return [...actions].sort((a, b) => {
    const ta = a.timestamp || "";
    const tb = b.timestamp || "";
    if (ta !== tb) return ta.localeCompare(tb);
    if (a.actionIndex !== b.actionIndex) return a.actionIndex - b.actionIndex;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (part.includes('rel="next"') && part.includes('results="true"')) {
      const m = part.match(/<([^>]+)>/);
      return m?.[1] ?? null;
    }
  }
  return null;
}

async function sentryFetch(url: string): Promise<Response> {
  const { authToken } = config.sentry;
  if (!authToken) {
    throw new Error("SENTRY_AUTH_TOKEN not configured");
  }
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
    },
  });
}

function sentryApiPath(path: string): string {
  const base = config.sentry.baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

export class SentryApiError extends Error {
  constructor(
    public readonly status: number,
    body: string
  ) {
    super(`Sentry API ${status}: ${body.slice(0, 200)}`);
    this.name = "SentryApiError";
  }
}

async function readSentryError(res: Response): Promise<never> {
  const text = await res.text();
  throw new SentryApiError(res.status, text);
}

export async function fetchDiscoverEvents(
  query: string,
  statsPeriod = "14d",
  fields: readonly string[] = SENTRY_DISCOVER_FIELDS,
  dataset?: string
): Promise<SentryDiscoverRow[]> {
  const { org } = config.sentry;
  const params = new URLSearchParams();
  for (const f of fields) {
    params.append("field", f);
  }
  params.set("query", query);
  params.set("sort", "-timestamp");
  params.set("per_page", "100");
  params.set("statsPeriod", statsPeriod);
  if (dataset) params.set("dataset", dataset);

  let url: string | null =
    `${sentryApiPath(`/api/0/organizations/${encodeURIComponent(org)}/events/`)}?${params.toString()}`;

  const rows: SentryDiscoverRow[] = [];
  let pages = 0;
  const maxPages = 20;

  while (url && pages < maxPages) {
    const res = await sentryFetch(url);
    if (!res.ok) {
      await readSentryError(res);
    }
    const body = (await res.json()) as { data?: SentryDiscoverRow[] };
    rows.push(...(body.data ?? []));
    url = parseNextLink(res.headers.get("link"));
    pages++;
  }

  return rows;
}

export async function fetchHttpClientSpans(statsPeriod = "24h"): Promise<SentryDiscoverRow[]> {
  try {
    return await fetchDiscoverEvents(
      SENTRY_SPAN_QUERY,
      statsPeriod,
      SENTRY_SPAN_FIELDS,
      "spans"
    );
  } catch (err) {
    console.warn("[sentry] spans dataset query failed, falling back to events", err);
    return fetchDiscoverEvents(
      `transaction.op:http.client AND (${[
        "transaction:*gwiza.tech*",
        "transaction:*djyh.rw*",
        "transaction:*core-api.ddin.rw*",
        "transaction:*intelligra.io*",
        "transaction:*resolveit.rw*",
      ].join(" OR ")})`,
      statsPeriod,
      [...SENTRY_DISCOVER_FIELDS, "transaction.op"]
    );
  }
}

export async function fetchSentryEventDetail(
  eventId: string
): Promise<Record<string, unknown> | null> {
  const { org, project } = config.sentry;
  const url = sentryApiPath(
    `/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/events/${encodeURIComponent(eventId)}/`
  );
  const res = await sentryFetch(url);
  if (res.status === 404) return null;
  if (!res.ok) await readSentryError(res);
  return (await res.json()) as Record<string, unknown>;
}

export function sessionActionsFromEventDetail(
  event: Record<string, unknown>,
  fallbackSessionId: string
): SessionAction[] {
  const eventId = String(event.event_id ?? event.id ?? "");
  const journeys = journeyActionsFromBreadcrumbs(event, fallbackSessionId, eventId);
  return journeys.map((j, i) => journeyToSessionAction(j, i));
}

export async function fetchSessionEventsFromSentry(
  sessionId: string
): Promise<SessionAction[]> {
  const rows = await fetchDiscoverEvents(
    `tags[session_id]:${sessionId}`,
    "30d"
  );
  const actions: SessionAction[] = [];
  const seenTxn = new Set<string>();
  for (const row of rows) {
    const action = rowToSessionAction(row);
    if (action) actions.push(action);
    const txnId = str(row, "id");
    if (txnId && seenTxn.size < 8 && !seenTxn.has(txnId)) {
      seenTxn.add(txnId);
      try {
        const detail = await fetchSentryEventDetail(txnId);
        if (detail) {
          actions.push(...sessionActionsFromEventDetail(detail, sessionId));
        }
      } catch (err) {
        console.warn("[session] event detail fetch failed", txnId, err);
      }
    }
  }
  return sortActionsByIndex(actions);
}

export async function fetchSentryIssue(
  issueId: string
): Promise<Record<string, unknown>> {
  const { org } = config.sentry;

  const orgIssueUrl = sentryApiPath(
    `/api/0/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(issueId)}/`
  );
  let res = await sentryFetch(orgIssueUrl);
  if (res.ok) {
    return (await res.json()) as Record<string, unknown>;
  }

  if (res.status !== 404) {
    await readSentryError(res);
  }

  const legacyUrl = sentryApiPath(
    `/api/0/issues/${encodeURIComponent(issueId)}/`
  );
  res = await sentryFetch(legacyUrl);
  if (res.ok) {
    return (await res.json()) as Record<string, unknown>;
  }

  if (res.status !== 404) {
    await readSentryError(res);
  }

  const list = await fetchSentryIssuesList(1, 100);
  const found = list.issues.find((i) => String(i.id) === issueId);
  if (found) return found;

  throw new SentryApiError(404, '{"detail":"The requested resource does not exist"}');
}

export async function fetchSentryIssuesList(
  _page = 1,
  limit = 20
): Promise<{ issues: Record<string, unknown>[]; hasMore: boolean }> {
  const { org, project } = config.sentry;
  const params = new URLSearchParams();
  params.set("query", "is:unresolved");
  params.set("per_page", String(Math.min(limit, 100)));

  const res = await sentryFetch(
    `${sentryApiPath(
      `/api/0/projects/${encodeURIComponent(org)}/${encodeURIComponent(project)}/issues/`
    )}?${params.toString()}`
  );
  if (!res.ok) {
    await readSentryError(res);
  }
  const issues = (await res.json()) as Record<string, unknown>[];
  const link = res.headers.get("link");
  const hasMore = link?.includes('rel="next"') ?? false;
  return { issues, hasMore };
}

export async function findSessionIdForIssue(
  issueId: string
): Promise<string | null> {
  const { org } = config.sentry;
  const params = new URLSearchParams();
  for (const f of SENTRY_DISCOVER_FIELDS) {
    params.append("field", f);
  }
  params.set("query", `issue:${issueId}`);
  params.set("sort", "-timestamp");
  params.set("per_page", "5");
  params.set("statsPeriod", "14d");

  const res = await sentryFetch(
    `${sentryApiPath(
      `/api/0/organizations/${encodeURIComponent(org)}/events/`
    )}?${params.toString()}`
  );
  if (!res.ok) return null;

  const body = (await res.json()) as { data?: SentryDiscoverRow[] };
  for (const row of body.data ?? []) {
    const sid = tag(row, "session_id");
    if (sid) return sid;
  }
  return null;
}

export function extractUserFromActions(
  actions: SessionAction[]
): {
  id: string | null;
  email: string | null;
  role: string | null;
  accountType: string | null;
} {
  for (const a of actions) {
    if (a.role || a.accountType) {
      return {
        id: null,
        email: null,
        role: a.role,
        accountType: a.accountType,
      };
    }
  }
  return { id: null, email: null, role: null, accountType: null };
}
