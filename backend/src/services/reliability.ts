/**
 * Issue monitoring for an organization project (workplan 9.1.5): incidents on the
 * services the project depends on, how fast they were resolved, who they hit, and
 * payment-channel reliability (an agent who cannot transact cannot earn).
 */
import type { Pool } from "pg";
import { SERVICES, SERVICE_LABELS, type ServiceName, paymentServices, thresholdsFor } from "../constants.js";
import type { DateRange } from "./monitorJourney.js";
import { errorRateToDisplayStatus, getErrorRateLast5Minutes, type DisplayStatus } from "./slidingWindow.js";
import { listProjectUpstreams } from "./tenancy.js";
import { overlapSecondsInMonth } from "./uptime.js";

/** Ops services (with incident tracking) that this project calls. */
export async function projectServices(pool: Pool, projectId: string): Promise<ServiceName[]> {
  const upstreams = await listProjectUpstreams(pool, projectId);
  const slugs = new Set(upstreams.map((u) => u.slug.toUpperCase()));
  return SERVICES.filter((s) => slugs.has(s));
}

const OK_SQL = `((e.status_code BETWEEN 200 AND 399)
  OR (COALESCE(e.status_code, 0) = 0 AND UPPER(COALESCE(e.outcome, '')) = 'SUCCESS'))`;
const USER_SQL = `COALESCE(NULLIF(TRIM(e.user_id), ''), NULLIF(TRIM(e.user_email), ''), e.session_id)`;
/** Collapse ids and query strings so `/wallet/balance/6738` groups with its siblings. */
export const ENDPOINT_GROUP_SQL = `regexp_replace(regexp_replace(split_part(COALESCE(NULLIF(e.endpoint, ''), '/'), '?', 1),
  '/([0-9]+|[0-9a-z]{20,}|[0-9a-f-]{36})(?=/|$)', '/{id}', 'g'), '/+$', '')`;

export const INCIDENT_LIST_LIMIT = 200;

export type IncidentRow = {
  id: string;
  service: string;
  severity: string;
  status: string;
  title: string;
  openedAt: string;
  resolvedAt: string | null;
  durationMinutes: number;
  autoResolved: boolean;
  resolution: string | null;
  usersAffected: number;
  failedCalls: number;
  notes: number;
};

export type IncidentSummary = {
  total: number;
  openNow: number;
  bySeverity: Record<string, number>;
  meanResolutionMinutes: number | null;
  medianResolutionMinutes: number | null;
  p90ResolutionMinutes: number | null;
  downtimeMinutes: number;
  longestMinutes: number | null;
  autoResolvedShare: number | null;
  manuallyResolved: number;
  usersAffected: number;
};

export type ServiceReliability = {
  service: string;
  label: string;
  payment: boolean;
  thresholdPct: number;
  incidents: number;
  downtimeMinutes: number;
  availability: number;
  medianResolutionMinutes: number | null;
  meanResolutionMinutes: number | null;
  longestMinutes: number | null;
  bySeverity: Record<string, number>;
  lastIncidentAt: string | null;
};

export type IncidentReport = {
  services: string[];
  summary: IncidentSummary;
  byService: ServiceReliability[];
  incidents: IncidentRow[];
};

export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/** Pure summary over incident rows; `now` bounds still-open incidents. */
export function summarizeIncidents(
  rows: { severity: string; status: string; openedAt: Date; resolvedAt: Date | null; autoResolved: boolean }[],
  range: DateRange,
  now = new Date()
): Omit<IncidentSummary, "usersAffected"> {
  const bySeverity: Record<string, number> = {};
  const resolvedMinutes: number[] = [];
  let downtimeSec = 0;
  let longest: number | null = null;
  let auto = 0;
  let resolved = 0;
  for (const r of rows) {
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    const end = r.resolvedAt ?? now;
    const mins = (end.getTime() - r.openedAt.getTime()) / 60000;
    longest = longest == null ? mins : Math.max(longest, mins);
    downtimeSec += overlapSecondsInMonth(r.openedAt, r.resolvedAt ?? now, range.from, range.to);
    if (r.resolvedAt) {
      resolved += 1;
      resolvedMinutes.push(mins);
      if (r.autoResolved) auto += 1;
    }
  }
  resolvedMinutes.sort((a, b) => a - b);
  return {
    total: rows.length,
    openNow: rows.filter((r) => r.status !== "resolved").length,
    bySeverity,
    meanResolutionMinutes: resolvedMinutes.length ? resolvedMinutes.reduce((s, m) => s + m, 0) / resolvedMinutes.length : null,
    medianResolutionMinutes: percentile(resolvedMinutes, 0.5),
    p90ResolutionMinutes: percentile(resolvedMinutes, 0.9),
    downtimeMinutes: downtimeSec / 60,
    longestMinutes: longest,
    autoResolvedShare: resolved ? auto / resolved : null,
    manuallyResolved: resolved - auto,
  };
}

export async function getIncidentReport(pool: Pool, projectId: string, range: DateRange): Promise<IncidentReport> {
  const services = await projectServices(pool, projectId);
  const empty: IncidentReport = {
    services,
    summary: { ...summarizeIncidents([], range), usersAffected: 0 },
    byService: [],
    incidents: [],
  };
  if (services.length === 0) return empty;

  // Incidents overlapping the window (opened before its end, not resolved before its start).
  // Metrics use every incident; only the listed rows carry the (costlier) impact lookup.
  const overlap = `i.service = ANY($1) AND i.opened_at <= $3 AND (i.resolved_at IS NULL OR i.resolved_at >= $2)`;
  const all = await pool.query<{
    service: string;
    severity: string;
    status: string;
    opened_at: Date;
    resolved_at: Date | null;
    auto_resolved: boolean;
  }>(
    `SELECT service, severity, status, opened_at, resolved_at, auto_resolved
     FROM incidents i WHERE ${overlap} ORDER BY opened_at DESC`,
    [services, range.from, range.to]
  );
  const q = await pool.query<{
    id: string;
    service: string;
    severity: string;
    status: string;
    title: string;
    opened_at: Date;
    resolved_at: Date | null;
    auto_resolved: boolean;
    resolution_reason: string | null;
    last_note: string | null;
    notes: string;
    users_affected: string;
    failed_calls: string;
  }>(
    `SELECT i.id::text, i.service, i.severity, i.status, i.title, i.opened_at, i.resolved_at,
            i.auto_resolved, i.resolution_reason,
            (SELECT n.body FROM incident_notes n WHERE n.incident_id = i.id ORDER BY n.created_at DESC LIMIT 1) AS last_note,
            (SELECT COUNT(*) FROM incident_notes n WHERE n.incident_id = i.id)::text AS notes,
            impact.users_affected, impact.failed_calls
     FROM incidents i
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT ${USER_SQL})::text AS users_affected, COUNT(*)::text AS failed_calls
       FROM api_events_real e
       WHERE e.service = i.service
         AND e.occurred_at >= i.opened_at - interval '5 minutes'
         AND e.occurred_at <= COALESCE(i.resolved_at, now())
         AND (e.project_id = $4 OR e.project_id IS NULL)
         AND NOT ${OK_SQL}
     ) impact ON true
     WHERE ${overlap}
     ORDER BY i.opened_at DESC
     LIMIT ${INCIDENT_LIST_LIMIT}`,
    [services, range.from, range.to, projectId]
  );

  const rows = all.rows.map((r) => ({
    severity: r.severity,
    status: r.status,
    openedAt: r.opened_at,
    resolvedAt: r.resolved_at,
    autoResolved: r.auto_resolved,
    service: r.service,
  }));
  const usersQ = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT ${USER_SQL})::text AS n
     FROM incidents i
     JOIN api_events_real e ON e.service = i.service
       AND e.occurred_at >= i.opened_at - interval '5 minutes'
       AND e.occurred_at <= COALESCE(i.resolved_at, now())
     WHERE i.service = ANY($1) AND i.opened_at <= $3 AND (i.resolved_at IS NULL OR i.resolved_at >= $2)
       AND (e.project_id = $4 OR e.project_id IS NULL)
       AND NOT ${OK_SQL}`,
    [services, range.from, range.to, projectId]
  );

  const rangeMinutes = Math.max(1, (range.to.getTime() - range.from.getTime()) / 60000);
  const byService: ServiceReliability[] = services.map((service) => {
    const own = rows.filter((r) => r.service === service);
    const s = summarizeIncidents(own, range);
    return {
      service,
      label: SERVICE_LABELS[service],
      payment: paymentServices().includes(service),
      thresholdPct: thresholdsFor(service).degraded * 100,
      incidents: own.length,
      downtimeMinutes: s.downtimeMinutes,
      availability: Math.max(0, 1 - s.downtimeMinutes / rangeMinutes),
      medianResolutionMinutes: s.medianResolutionMinutes,
      meanResolutionMinutes: s.meanResolutionMinutes,
      longestMinutes: s.longestMinutes,
      bySeverity: s.bySeverity,
      lastIncidentAt: own[0]?.openedAt.toISOString() ?? null,
    };
  });

  return {
    services,
    summary: { ...summarizeIncidents(rows, range), usersAffected: Number(usersQ.rows[0]?.n ?? 0) },
    byService,
    incidents: q.rows.map((r) => ({
      id: r.id,
      service: r.service,
      severity: r.severity,
      status: r.status,
      title: r.title,
      openedAt: r.opened_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      durationMinutes: ((r.resolved_at ?? new Date()).getTime() - r.opened_at.getTime()) / 60000,
      autoResolved: r.auto_resolved,
      resolution: r.last_note ?? r.resolution_reason,
      usersAffected: Number(r.users_affected ?? 0),
      failedCalls: Number(r.failed_calls ?? 0),
      notes: Number(r.notes),
    })),
  };
}

export type IncidentDetail = IncidentRow & {
  triggerErrorRate: number | null;
  resolutionReason: string | null;
  notesList: { id: string; body: string; author: string | null; createdAt: string }[];
  failingEndpoints: { method: string; path: string; failures: number; users: number; lastStatus: number | null }[];
  affectedUsers: { userKey: string; email: string | null; failures: number }[];
};

export async function getIncidentDetail(
  pool: Pool,
  projectId: string,
  incidentId: string
): Promise<IncidentDetail | null> {
  const services = await projectServices(pool, projectId);
  const q = await pool.query(
    `SELECT id::text, service, severity, status, title, opened_at, resolved_at, auto_resolved,
            resolution_reason, trigger_error_rate
     FROM incidents WHERE id::text = $1 AND service = ANY($2)`,
    [incidentId, services]
  );
  const i = q.rows[0];
  if (!i) return null;
  const params = [i.service, i.opened_at, i.resolved_at ?? new Date(), projectId];
  const window = `e.service = $1 AND e.occurred_at >= $2::timestamptz - interval '5 minutes' AND e.occurred_at <= $3
                  AND (e.project_id = $4 OR e.project_id IS NULL) AND NOT ${OK_SQL}`;
  const [notes, endpoints, users] = await Promise.all([
    pool.query(`SELECT id::text, body, author, created_at FROM incident_notes WHERE incident_id = $1 ORDER BY created_at ASC`, [i.id]),
    pool.query<{ method: string; path: string; failures: string; users: string; last_status: number | null }>(
      `SELECT COALESCE(e.http_method, '') AS method, ${ENDPOINT_GROUP_SQL} AS path,
              COUNT(*)::text AS failures, COUNT(DISTINCT ${USER_SQL})::text AS users,
              (ARRAY_AGG(e.status_code ORDER BY e.occurred_at DESC))[1] AS last_status
       FROM api_events_real e WHERE ${window}
       GROUP BY 1, 2 ORDER BY COUNT(*) DESC LIMIT 10`,
      params
    ),
    pool.query<{ user_key: string; email: string | null; failures: string }>(
      `SELECT ${USER_SQL} AS user_key, MAX(NULLIF(TRIM(e.user_email), '')) AS email, COUNT(*)::text AS failures
       FROM api_events_real e WHERE ${window}
       GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 50`,
      params
    ),
  ]);
  const last = notes.rows[notes.rows.length - 1];
  return {
    id: i.id,
    service: i.service,
    severity: i.severity,
    status: i.status,
    title: i.title,
    openedAt: i.opened_at.toISOString(),
    resolvedAt: i.resolved_at?.toISOString() ?? null,
    durationMinutes: ((i.resolved_at ?? new Date()).getTime() - i.opened_at.getTime()) / 60000,
    autoResolved: i.auto_resolved,
    resolution: last?.body ?? i.resolution_reason,
    usersAffected: users.rows.length,
    failedCalls: endpoints.rows.reduce((s, r) => s + Number(r.failures), 0),
    notes: notes.rows.length,
    triggerErrorRate: i.trigger_error_rate == null ? null : Number(i.trigger_error_rate),
    resolutionReason: i.resolution_reason,
    notesList: notes.rows.map((n) => ({ id: n.id, body: n.body, author: n.author, createdAt: n.created_at.toISOString() })),
    failingEndpoints: endpoints.rows.map((r) => ({
      method: r.method,
      path: r.path || "/",
      failures: Number(r.failures),
      users: Number(r.users),
      lastStatus: r.last_status,
    })),
    affectedUsers: users.rows.map((r) => ({ userKey: r.user_key, email: r.email, failures: Number(r.failures) })),
  };
}

/** Plain-language meaning of a failed payment call's HTTP status, for non-technical readers. */
export function statusMeaning(status: number | null): { label: string; hint: string } {
  if (status == null || status === 0) return { label: "No response", hint: "Network dropped or timed out before the provider answered — weak signal, offline phone or provider unreachable." };
  if (status === 401) return { label: "Login expired", hint: "The agent's payment session/token was rejected. The app should refresh the token or ask the agent to sign in again." };
  if (status === 403) return { label: "Not allowed", hint: "The account is not permitted to do this (blocked, KYC incomplete or wrong role)." };
  if (status === 404) return { label: "Not found", hint: "The wallet, account or route does not exist — often a wrong or missing wallet id from the app." };
  if (status === 400 || status === 422) return { label: "Invalid request", hint: "The app sent data the provider rejected (missing field, bad amount, 'undefined' id)." };
  if (status === 409) return { label: "Conflict", hint: "Duplicate or already-processed transaction." };
  if (status === 429) return { label: "Rate limited", hint: "Too many requests; the provider is throttling the app." };
  if (status >= 500) return { label: "Provider error", hint: "The payment provider failed internally — escalate to the provider." };
  if (status >= 400) return { label: `Client error ${status}`, hint: "The provider rejected the request." };
  return { label: `HTTP ${status}`, hint: "" };
}

export type PaymentEndpoint = {
  method: string;
  path: string;
  calls: number;
  failures: number;
  agents: number;
  agentsAffected: number;
  topStatus: number | null;
  p95LatencyMs: number | null;
};

export type StatusBreakdownRow = { status: number | null; count: number; agents: number; label: string; hint: string };

export type PaymentChannel = {
  slug: string;
  label: string;
  host: string;
  role: string | null;
  statusNow: DisplayStatus | "no_data";
  errorRate5m: number;
  thresholdPct: number;
  lastCallAt: string | null;
  calls: number;
  successRate: number | null;
  failures: number;
  agents: number;
  agentsAffected: number;
  p95LatencyMs: number | null;
  incidents: number;
  granularity: "hour" | "day";
  /** Kept as `daily` for compatibility; buckets are hourly for ranges of two days or less. */
  daily: { date: string; calls: number; failures: number; successRate: number | null }[];
  failingEndpoints: { method: string; path: string; failures: number; calls: number; agents: number; topStatus: number | null }[];
  endpoints: PaymentEndpoint[];
  statusBreakdown: StatusBreakdownRow[];
};

export type PaymentsReport = {
  channels: PaymentChannel[];
  overall: { calls: number; successRate: number | null; agentsAffected: number; failures: number };
  hasBackup: boolean;
};

function bucketFor(range: DateRange): "hour" | "day" {
  return range.to.getTime() - range.from.getTime() <= 2 * 86400_000 ? "hour" : "day";
}

export async function getPaymentsReport(pool: Pool, projectId: string, range: DateRange): Promise<PaymentsReport> {
  const upstreams = (await listProjectUpstreams(pool, projectId)).filter((u) => u.category === "payments");
  const scope = `e.service = $1 AND e.occurred_at >= $2 AND e.occurred_at <= $3 AND (e.project_id = $4 OR e.project_id IS NULL)`;
  const granularity = bucketFor(range);
  const bucketFmt = granularity === "hour" ? "YYYY-MM-DD\"T\"HH24:00" : "YYYY-MM-DD";

  const channels = await Promise.all(
    upstreams.map(async (u): Promise<PaymentChannel> => {
      const params = [u.slug, range.from, range.to, projectId];
      const [totals, series, endpoints, statuses, incidents, rate5m, recent, last] = await Promise.all([
        pool.query<{ calls: string; ok: string; agents: string; affected: string; p95: string | null }>(
          `SELECT COUNT(*)::text AS calls, COUNT(*) FILTER (WHERE ${OK_SQL})::text AS ok,
                  COUNT(DISTINCT ${USER_SQL})::text AS agents,
                  COUNT(DISTINCT ${USER_SQL}) FILTER (WHERE NOT ${OK_SQL})::text AS affected,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY e.latency_ms)::text AS p95
           FROM api_events_real e WHERE ${scope}`,
          params
        ),
        pool.query<{ bucket: string; calls: string; ok: string }>(
          `SELECT to_char(date_trunc('${granularity}', e.occurred_at AT TIME ZONE 'Africa/Kigali'), '${bucketFmt}') AS bucket,
                  COUNT(*)::text AS calls, COUNT(*) FILTER (WHERE ${OK_SQL})::text AS ok
           FROM api_events_real e WHERE ${scope} GROUP BY 1 ORDER BY 1`,
          params
        ),
        pool.query<{ method: string; path: string; calls: string; failures: string; agents: string; affected: string; top_status: number | null; p95: string | null }>(
          `SELECT COALESCE(e.http_method, '') AS method, ${ENDPOINT_GROUP_SQL} AS path, COUNT(*)::text AS calls,
                  COUNT(*) FILTER (WHERE NOT ${OK_SQL})::text AS failures,
                  COUNT(DISTINCT ${USER_SQL})::text AS agents,
                  COUNT(DISTINCT ${USER_SQL}) FILTER (WHERE NOT ${OK_SQL})::text AS affected,
                  MODE() WITHIN GROUP (ORDER BY e.status_code) FILTER (WHERE NOT ${OK_SQL}) AS top_status,
                  percentile_cont(0.95) WITHIN GROUP (ORDER BY e.latency_ms)::text AS p95
           FROM api_events_real e WHERE ${scope}
           GROUP BY 1, 2
           ORDER BY COUNT(*) FILTER (WHERE NOT ${OK_SQL}) DESC, COUNT(*) DESC LIMIT 40`,
          params
        ),
        pool.query<{ status: number | null; n: string; agents: string }>(
          `SELECT NULLIF(e.status_code, 0) AS status, COUNT(*)::text AS n, COUNT(DISTINCT ${USER_SQL})::text AS agents
           FROM api_events_real e WHERE ${scope} AND NOT ${OK_SQL}
           GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
          params
        ),
        pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM incidents
           WHERE service = $1 AND opened_at <= $3 AND (resolved_at IS NULL OR resolved_at >= $2)`,
          [u.slug, range.from, range.to]
        ),
        (SERVICES as readonly string[]).includes(u.slug)
          ? getErrorRateLast5Minutes(pool, u.slug as ServiceName)
          : Promise.resolve(0),
        pool.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM api_events_real WHERE service = $1 AND occurred_at >= now() - interval '5 minutes'`,
          [u.slug]
        ),
        pool.query<{ at: Date | null }>(`SELECT MAX(occurred_at) AS at FROM api_events_real WHERE service = $1`, [u.slug]),
      ]);
      const t = totals.rows[0]!;
      const calls = Number(t.calls);
      const eps: PaymentEndpoint[] = endpoints.rows.map((r) => ({
        method: r.method,
        path: r.path || "/",
        calls: Number(r.calls),
        failures: Number(r.failures),
        agents: Number(r.agents),
        agentsAffected: Number(r.affected),
        topStatus: r.top_status,
        p95LatencyMs: r.p95 == null ? null : Math.round(Number(r.p95)),
      }));
      return {
        slug: u.slug,
        label: u.label || u.slug,
        host: u.host,
        role: u.channelRole,
        statusNow: Number(recent.rows[0]?.n ?? 0) === 0 ? "no_data" : errorRateToDisplayStatus(rate5m, u.slug),
        errorRate5m: rate5m,
        thresholdPct: thresholdsFor(u.slug).degraded * 100,
        lastCallAt: last.rows[0]?.at?.toISOString() ?? null,
        calls,
        successRate: calls ? Number(t.ok) / calls : null,
        failures: calls - Number(t.ok),
        agents: Number(t.agents),
        agentsAffected: Number(t.affected),
        p95LatencyMs: t.p95 == null ? null : Math.round(Number(t.p95)),
        incidents: Number(incidents.rows[0]?.n ?? 0),
        granularity,
        daily: series.rows.map((d) => ({
          date: d.bucket,
          calls: Number(d.calls),
          failures: Number(d.calls) - Number(d.ok),
          successRate: Number(d.calls) ? Number(d.ok) / Number(d.calls) : null,
        })),
        failingEndpoints: eps
          .filter((e) => e.failures > 0)
          .slice(0, 8)
          .map(({ method, path, failures, calls: c, agentsAffected, topStatus }) => ({ method, path, failures, calls: c, agents: agentsAffected, topStatus })),
        endpoints: eps,
        statusBreakdown: statuses.rows.map((r) => ({
          status: r.status,
          count: Number(r.n),
          agents: Number(r.agents),
          ...statusMeaning(r.status),
        })),
      };
    })
  );

  channels.sort((a, b) => (a.role === "primary" ? -1 : b.role === "primary" ? 1 : b.calls - a.calls));
  const calls = channels.reduce((s, c) => s + c.calls, 0);
  const failures = channels.reduce((s, c) => s + c.failures, 0);
  const affected =
    upstreams.length === 0
      ? 0
      : Number(
          (
            await pool.query<{ n: string }>(
              `SELECT COUNT(DISTINCT ${USER_SQL})::text AS n FROM api_events_real e
               WHERE e.service = ANY($1) AND e.occurred_at >= $2 AND e.occurred_at <= $3
                 AND (e.project_id = $4 OR e.project_id IS NULL) AND NOT ${OK_SQL}`,
              [upstreams.map((u) => u.slug), range.from, range.to, projectId]
            )
          ).rows[0]?.n ?? 0
        );
  return {
    channels,
    overall: { calls, failures, successRate: calls ? (calls - failures) / calls : null, agentsAffected: affected },
    hasBackup: channels.some((c) => c.role === "backup"),
  };
}

export type AffectedAgent = {
  userKey: string;
  email: string | null;
  userId: string | null;
  calls: number;
  failures: number;
  successes: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastStatus: number | null;
  lastStatusLabel: string;
  lastError: string | null;
  lastScreen: string | null;
  lastEventId: string | null;
  recoveredAfter: boolean;
  platform: string | null;
  appVersion: string | null;
};

export type PaymentEndpointDetail = {
  service: string;
  method: string | null;
  path: string | null;
  calls: number;
  failures: number;
  successRate: number | null;
  agents: number;
  agentsAffected: number;
  statusBreakdown: StatusBreakdownRow[];
  granularity: "hour" | "day";
  series: { date: string; calls: number; failures: number }[];
  affected: AffectedAgent[];
};

/** Short, human-readable error from a stored failure: reason first, then the provider's message field. */
export function extractErrorMessage(failureReason: string | null, responseBody: string | null): string | null {
  if (failureReason && failureReason.trim() && !/^(network|other)$/i.test(failureReason.trim())) return failureReason.trim().slice(0, 200);
  if (!responseBody) return failureReason?.trim() || null;
  try {
    const j = JSON.parse(responseBody) as Record<string, unknown>;
    for (const k of ["message", "error_description", "error", "detail", "msg", "description"]) {
      const v = j[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
      if (v && typeof v === "object" && typeof (v as { message?: unknown }).message === "string") {
        return String((v as { message: string }).message).slice(0, 200);
      }
    }
  } catch {
    /* not JSON */
  }
  const text = responseBody.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 160) : null;
}

/** One payment endpoint (or the whole channel when method/path are omitted): who it failed for and how. */
export async function getPaymentEndpointDetail(
  pool: Pool,
  projectId: string,
  range: DateRange,
  filter: { service: string; method?: string; path?: string; status?: number | null; search?: string }
): Promise<PaymentEndpointDetail> {
  const conds = [`e.service = $1`, `e.occurred_at >= $2`, `e.occurred_at <= $3`, `(e.project_id = $4 OR e.project_id IS NULL)`];
  const params: unknown[] = [filter.service, range.from, range.to, projectId];
  if (filter.method) {
    params.push(filter.method.toUpperCase());
    conds.push(`UPPER(COALESCE(e.http_method, '')) = $${params.length}`);
  }
  if (filter.path) {
    params.push(filter.path);
    conds.push(`${ENDPOINT_GROUP_SQL} = $${params.length}`);
  }
  const where = conds.join(" AND ");
  // Status narrows only the affected-agent list, not the endpoint totals.
  const agentParams = [...params];
  let statusCond = "";
  if (filter.status !== undefined) {
    if (filter.status === null || filter.status === 0) statusCond = `AND COALESCE(e.status_code, 0) = 0`;
    else {
      agentParams.push(filter.status);
      statusCond = `AND e.status_code = $${agentParams.length}`;
    }
  }
  let searchCond = "";
  if (filter.search) {
    agentParams.push(`%${filter.search}%`);
    searchCond = `AND (${USER_SQL} ILIKE $${agentParams.length} OR COALESCE(e.user_email, '') ILIKE $${agentParams.length})`;
  }
  const granularity = bucketFor(range);
  const bucketFmt = granularity === "hour" ? "YYYY-MM-DD\"T\"HH24:00" : "YYYY-MM-DD";

  const [totals, statuses, series, agents] = await Promise.all([
    pool.query<{ calls: string; ok: string; agents: string; affected: string }>(
      `SELECT COUNT(*)::text AS calls, COUNT(*) FILTER (WHERE ${OK_SQL})::text AS ok,
              COUNT(DISTINCT ${USER_SQL})::text AS agents,
              COUNT(DISTINCT ${USER_SQL}) FILTER (WHERE NOT ${OK_SQL})::text AS affected
       FROM api_events_real e WHERE ${where}`,
      params
    ),
    pool.query<{ status: number | null; n: string; agents: string }>(
      `SELECT NULLIF(e.status_code, 0) AS status, COUNT(*)::text AS n, COUNT(DISTINCT ${USER_SQL})::text AS agents
       FROM api_events_real e WHERE ${where} AND NOT ${OK_SQL} GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 10`,
      params
    ),
    pool.query<{ bucket: string; calls: string; ok: string }>(
      `SELECT to_char(date_trunc('${granularity}', e.occurred_at AT TIME ZONE 'Africa/Kigali'), '${bucketFmt}') AS bucket,
              COUNT(*)::text AS calls, COUNT(*) FILTER (WHERE ${OK_SQL})::text AS ok
       FROM api_events_real e WHERE ${where} GROUP BY 1 ORDER BY 1`,
      params
    ),
    pool.query<{
      user_key: string;
      email: string | null;
      user_id: string | null;
      calls: string;
      failures: string;
      first_fail: Date | null;
      last_fail: Date | null;
      last_ok: Date | null;
      last_status: number | null;
      last_reason: string | null;
      last_body: string | null;
      last_screen: string | null;
      last_event: string | null;
      platform: string | null;
      app_version: string | null;
    }>(
      `WITH per AS (
         SELECT ${USER_SQL} AS user_key,
                MAX(NULLIF(TRIM(e.user_email), '')) AS email, MAX(NULLIF(TRIM(e.user_id), '')) AS user_id,
                COUNT(*)::text AS calls, COUNT(*) FILTER (WHERE NOT ${OK_SQL})::text AS failures,
                MIN(e.occurred_at) FILTER (WHERE NOT ${OK_SQL}) AS first_fail,
                MAX(e.occurred_at) FILTER (WHERE NOT ${OK_SQL}) AS last_fail,
                MAX(e.occurred_at) FILTER (WHERE ${OK_SQL}) AS last_ok
         FROM api_events_real e WHERE ${where} ${searchCond}
         GROUP BY 1
         HAVING COUNT(*) FILTER (WHERE NOT ${OK_SQL} ${statusCond}) > 0
       )
       SELECT per.*, lf.status_code AS last_status, lf.failure_reason AS last_reason,
              LEFT(lf.response_body, 2000) AS last_body, lf.current_screen AS last_screen,
              COALESCE(lf.sentry_event_id, 'api:' || lf.id::text) AS last_event,
              us.platform, us.app_version
       FROM per
       LEFT JOIN LATERAL (
         SELECT e.* FROM api_events_real e
         WHERE ${where} AND ${USER_SQL} = per.user_key AND NOT ${OK_SQL} ${statusCond}
         ORDER BY e.occurred_at DESC LIMIT 1
       ) lf ON true
       LEFT JOIN user_sessions us ON us.session_id = lf.session_id
       ORDER BY per.failures::int DESC, per.last_fail DESC
       LIMIT 200`,
      agentParams
    ),
  ]);
  const t = totals.rows[0]!;
  const calls = Number(t.calls);
  return {
    service: filter.service,
    method: filter.method ?? null,
    path: filter.path ?? null,
    calls,
    failures: calls - Number(t.ok),
    successRate: calls ? Number(t.ok) / calls : null,
    agents: Number(t.agents),
    agentsAffected: Number(t.affected),
    statusBreakdown: statuses.rows.map((r) => ({ status: r.status, count: Number(r.n), agents: Number(r.agents), ...statusMeaning(r.status) })),
    granularity,
    series: series.rows.map((r) => ({ date: r.bucket, calls: Number(r.calls), failures: Number(r.calls) - Number(r.ok) })),
    affected: agents.rows.map((r) => ({
      userKey: r.user_key,
      email: r.email,
      userId: r.user_id,
      calls: Number(r.calls),
      failures: Number(r.failures),
      successes: Number(r.calls) - Number(r.failures),
      firstFailureAt: r.first_fail?.toISOString() ?? null,
      lastFailureAt: r.last_fail?.toISOString() ?? null,
      lastStatus: r.last_status,
      lastStatusLabel: statusMeaning(r.last_status).label,
      lastError: extractErrorMessage(r.last_reason, r.last_body),
      lastScreen: r.last_screen,
      lastEventId: r.last_event,
      recoveredAfter: Boolean(r.last_ok && r.last_fail && r.last_ok > r.last_fail),
      platform: r.platform,
      appVersion: r.app_version,
    })),
  };
}
