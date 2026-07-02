import { config } from "../../config.js";
import { SENTRY_DISCOVER_FIELDS } from "./discoverFields.js";
import type { SessionAction } from "../../types/sessionInvestigation.js";

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

  return {
    id: str(row, "id"),
    timestamp: str(row, "timestamp"),
    message: str(row, "message") || null,
    type: sentryType || null,
    status: tag(row, "status") || null,
    actionType: tag(row, "action_type") || null,
    service: tag(row, "service") || null,
    method: tag(row, "method") || null,
    endpoint: tag(row, "endpoint") || null,
    httpStatus: tag(row, "http_status") || null,
    actionIndex: Number.isFinite(actionIndex) ? actionIndex : 0,
    orderId: tag(row, "order_id") || null,
    failureReason: tag(row, "failure_reason") || null,
    role: tag(row, "role") || null,
    accountType: tag(row, "account_type") || null,
  };
}

export function sortActionsByIndex(actions: SessionAction[]): SessionAction[] {
  return [...actions].sort((a, b) => {
    if (a.actionIndex !== b.actionIndex) return a.actionIndex - b.actionIndex;
    return a.timestamp.localeCompare(b.timestamp);
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
  statsPeriod = "14d"
): Promise<SentryDiscoverRow[]> {
  const { org } = config.sentry;
  const params = new URLSearchParams();
  for (const f of SENTRY_DISCOVER_FIELDS) {
    params.append("field", f);
  }
  params.set("query", query);
  params.set("sort", "-timestamp");
  params.set("per_page", "100");
  params.set("statsPeriod", statsPeriod);

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

export async function fetchSessionEventsFromSentry(
  sessionId: string
): Promise<SessionAction[]> {
  const rows = await fetchDiscoverEvents(
    `tags[session_id]:${sessionId}`,
    "30d"
  );
  const actions: SessionAction[] = [];
  for (const row of rows) {
    const action = rowToSessionAction(row);
    if (action) actions.push(action);
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
