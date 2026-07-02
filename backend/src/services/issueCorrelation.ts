import type { Pool } from "pg";
import {
  fetchDiscoverEvents,
  fetchSentryIssue,
  type SentryDiscoverRow,
} from "./sentry/sentryClient.js";
import { config } from "../config.js";

export type IssueCorrelationContext = {
  lastSeen: string;
  firstSeen?: string;
  title?: string;
};

function tag(row: SentryDiscoverRow, key: string): string {
  const v = row[`tags[${key}]`];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function sentryApiPath(path: string): string {
  const base = config.sentry.baseUrl;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

async function sentryFetch(url: string): Promise<Response> {
  const { authToken } = config.sentry;
  if (!authToken) throw new Error("SENTRY_AUTH_TOKEN not configured");
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
    },
  });
}

function sessionIdFromTags(tags: unknown): string | null {
  if (!tags) return null;
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const o = t as { key?: string; value?: string };
      if (o.key === "session_id" && o.value) return o.value.trim();
    }
    return null;
  }
  if (typeof tags === "object") {
    const v = (tags as Record<string, string>).session_id;
    if (v) return String(v).trim();
  }
  return null;
}

function sessionIdFromEvent(event: Record<string, unknown>): string | null {
  const fromTags = sessionIdFromTags(event.tags);
  if (fromTags) return fromTags;
  const ctx = event.context as Record<string, unknown> | undefined;
  if (ctx?.session_id) return String(ctx.session_id).trim();
  return null;
}

async function discoverInWindow(
  query: string,
  centerIso: string,
  paddingMinutes = 15
): Promise<SentryDiscoverRow[]> {
  const center = new Date(centerIso);
  if (Number.isNaN(center.getTime())) return [];
  const start = new Date(center.getTime() - paddingMinutes * 60_000);
  const end = new Date(center.getTime() + paddingMinutes * 60_000);

  const { org, project } = config.sentry;
  const scopedQuery = query.includes("project:")
    ? query
    : `project:${project} ${query}`;
  const params = new URLSearchParams();
  params.set("field", "id");
  params.set("field", "timestamp");
  params.set("field", "tags[session_id]");
  params.set("field", "tags[type]");
  params.set("field", "tags[http_status]");
  params.set("field", "tags[status]");
  params.set("field", "tags[endpoint]");
  params.set("field", "user.email");
  params.set("query", scopedQuery);
  params.set("sort", "-timestamp");
  params.set("per_page", "25");
  params.set("start", start.toISOString());
  params.set("end", end.toISOString());

  const res = await sentryFetch(
    `${sentryApiPath(`/api/0/organizations/${encodeURIComponent(org)}/events/`)}?${params.toString()}`
  );
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: SentryDiscoverRow[] };
  return body.data ?? [];
}

function pickClosestSession(
  rows: SentryDiscoverRow[],
  centerIso: string
): string | null {
  const center = new Date(centerIso).getTime();
  let best: { sid: string; delta: number } | null = null;
  for (const row of rows) {
    const sid = tag(row, "session_id");
    if (!sid) continue;
    const ts = new Date(String(row.timestamp ?? "")).getTime();
    if (Number.isNaN(ts)) continue;
    const delta = Math.abs(ts - center);
    if (!best || delta < best.delta) best = { sid, delta };
  }
  return best?.sid ?? null;
}

function httpStatusFromTitle(title: string | undefined): string | null {
  if (!title) return null;
  const m = title.match(/HTTP\s+(\d{3})/i);
  return m?.[1] ?? null;
}

async function fromIssueEvents(issueId: string): Promise<string | null> {
  const { org } = config.sentry;
  const res = await sentryFetch(
    sentryApiPath(
      `/api/0/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(issueId)}/events/?full=true&limit=20`
    )
  );
  if (!res.ok) return null;
  const events = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(events)) return null;
  for (const ev of events) {
    const sid = sessionIdFromEvent(ev);
    if (sid) return sid;
  }
  return null;
}

async function fromDiscoverIssue(issueId: string): Promise<string | null> {
  const rows = await fetchDiscoverEvents(`issue:${issueId}`, "14d");
  for (const row of rows) {
    const sid = tag(row, "session_id");
    if (sid) return sid;
  }
  return null;
}

async function fromTimeWindow(ctx: IssueCorrelationContext): Promise<string | null> {
  const status = httpStatusFromTitle(ctx.title);
  const queries = [
    "has:tags[session_id] tags[type]:api_failure",
    "has:tags[session_id] tags[type]:api_success",
    "has:tags[session_id]",
  ];
  if (status) {
    queries.unshift(
      `has:tags[session_id] tags[http_status]:${status}`,
      `has:tags[session_id] tags[type]:api_failure tags[http_status]:${status}`
    );
  }

  for (const q of queries) {
    const rows = await discoverInWindow(q, ctx.lastSeen, 20);
    const sid = pickClosestSession(rows, ctx.lastSeen);
    if (sid) return sid;
  }
  return null;
}

async function fromPostgres(
  pool: Pool,
  ctx: IssueCorrelationContext
): Promise<string | null> {
  const center = new Date(ctx.lastSeen);
  if (Number.isNaN(center.getTime())) return null;
  const status = httpStatusFromTitle(ctx.title);

  const params: unknown[] = [ctx.lastSeen];
  let statusFilter = "";
  if (status) {
    statusFilter = `AND status_code = $2`;
    params.push(Number(status));
  }

  const r = await pool.query<{ session_id: string }>(
    `SELECT session_id
     FROM api_events
     WHERE session_id IS NOT NULL
       AND outcome IN ('FAILURE', 'OTHER')
       AND occurred_at BETWEEN ($1::timestamptz - interval '20 minutes')
                           AND ($1::timestamptz + interval '5 minutes')
       ${statusFilter}
     ORDER BY ABS(EXTRACT(EPOCH FROM (occurred_at - $1::timestamptz)))
     LIMIT 1`,
    params
  );
  return r.rows[0]?.session_id ?? null;
}

export async function correlateIssueToSession(
  pool: Pool,
  issueId: string,
  ctx: IssueCorrelationContext
): Promise<string | null> {
  const strategies = [
    () => fromDiscoverIssue(issueId),
    () => fromIssueEvents(issueId),
    () => fromTimeWindow(ctx),
    () => fromPostgres(pool, ctx),
  ];

  for (const run of strategies) {
    try {
      const sid = await run();
      if (sid) return sid;
    } catch (err) {
      console.warn("[issue-correlation] strategy failed", err);
    }
  }
  return null;
}

export async function fetchIssueWithLatestEvent(
  issueId: string
): Promise<Record<string, unknown>> {
  const { org } = config.sentry;
  const url = sentryApiPath(
    `/api/0/organizations/${encodeURIComponent(org)}/issues/${encodeURIComponent(issueId)}/?expand=latestEvent`
  );
  const res = await sentryFetch(url);
  if (res.ok) {
    return (await res.json()) as Record<string, unknown>;
  }
  return fetchSentryIssue(issueId);
}
