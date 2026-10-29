/**
 * Evidence-quality inputs for the reports. Reviewers rightly objected that the
 * reports treated every failed request as a server outage, oversold retention
 * from a handful of small cohorts, and read engagement without discounting
 * retries. This module splits incomplete requests by cause and measures retries,
 * login loops and sessions that actually completed work, and it has pure helpers
 * that judge how far retention and screen-name data can be trusted.
 */
import type { Pool } from "pg";
import type { DateRange } from "./monitorJourney.js";
import { navKindSql, screenLabelSql } from "./monitorScreenLabel.js";
import { ENDPOINT_GROUP_SQL } from "./reliability.js";

export type FailureCause = "auth" | "client" | "server" | "network" | "unclassified";

export const CAUSE_LABEL: Record<FailureCause, string> = {
  auth: "Authentication / session (401, 403, failed login)",
  client: "Client / validation (other 4xx)",
  server: "Server failure (5xx)",
  network: "No response (network / timeout)",
  unclassified: "Unclassified (no HTTP status)",
};

export const CAUSE_MEANING: Record<FailureCause, string> = {
  auth: "Wrong credentials, expired or missing tokens. A product or integration issue, not an outage.",
  client: "The app sent a request the API rejected (bad input, missing id, unknown route).",
  server: "The API or its dependency failed. This is the true server-side reliability signal.",
  network: "No response reached the app: weak connectivity, timeouts or an unreachable provider.",
  unclassified: "Marked failed by the app without an HTTP status; cause unknown.",
};

/** Endpoint segments that identify login / token / OTP style calls. */
const AUTH_PATH_RE = String.raw`(^|/)(auth|login|signin|sign-in|logout|token|oauth2?|otp|password|reset-pin|verify-pin|refresh)(/|$|\?)`;

const TEST_SQL = `COALESCE(e.endpoint, e.request_url, '') ~* '(mock|sandbox|staging)'`;
const FAILED_SQL = `e.outcome IN ('FAILURE', 'OTHER')`;
const USER_SQL = `COALESCE(NULLIF(TRIM(e.user_id), ''), NULLIF(TRIM(e.user_email), ''), e.session_id)`;
export const CAUSE_SQL = `CASE
    WHEN e.status_code >= 500 THEN 'server'
    WHEN e.status_code IN (401, 403, 407, 419, 440)
      OR (e.status_code BETWEEN 400 AND 499 AND e.endpoint ~* '${AUTH_PATH_RE}') THEN 'auth'
    WHEN e.status_code BETWEEN 400 AND 499 THEN 'client'
    WHEN e.outcome = 'OTHER' OR COALESCE(e.failure_reason, '') ~* '(timeout|network|offline|abort)' THEN 'network'
    ELSE 'unclassified'
  END`;

export type CauseRow = {
  cause: FailureCause;
  label: string;
  meaning: string;
  count: number;
  users: number;
  share: number;
  topEndpoints: { method: string; path: string; count: number; status: number | null }[];
};

/** Per-service request health over real (non-test) traffic. */
export type ServiceStats = {
  service: string;
  requests: number;
  incomplete: number;
  serviceFailures: number;
  clientRejections: number;
  noStatus: number;
  /** Requests not failed on the server side (5xx / no response). */
  availability: number;
  /** All incomplete requests over all requests. */
  incompleteRate: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  users: number;
  usersAffected: number;
};

export type ReportQuality = {
  totalRequests: number;
  incomplete: number;
  causes: CauseRow[];
  /** 5xx + no response, over all requests: the server-side reliability signal. */
  serviceFailureRate: number;
  /** Requests that reached the server and were not failed by it. */
  serviceAvailability: number;
  /** Same, counting failures with no HTTP status as service failures too (worst case). */
  serviceFailureRateUpper: number;
  clientRejectionRate: number;
  /** Calls to mock / sandbox / staging endpoints: test traffic mixed into production data. */
  testTraffic: { requests: number; failed: number };
  login: { attempts: number; failed: number; usersFailed: number; usersFailedRepeatedly: number };
  /** Failed calls repeating the same call in the same session within 2 minutes of a previous failure. */
  retryFailures: number;
  sessionsTotal: number;
  /** Sessions with at least one successful non-login API call. */
  sessionsCompletedWork: number;
  usersTotal: number;
  usersCompletedWork: number;
  /** Sessions that visited a login screen two or more times. */
  loginLoopSessions: number;
  daily: { date: string; serviceFailures: number; authFailures: number; clientFailures: number }[];
  /** Real traffic per service (mock/sandbox excluded), busiest first. */
  byService: ServiceStats[];
};

export async function getReportQuality(pool: Pool, projectId: string, range: DateRange): Promise<ReportQuality> {
  const p = [projectId, range.from, range.to];
  const baseScope = `e.project_id = $1 AND e.occurred_at >= $2 AND e.occurred_at <= $3`;
  // Test traffic (mock / sandbox / staging endpoints) is not real usage: it is reported
  // on its own and excluded from every rate below.
  const scope = `${baseScope} AND NOT ${TEST_SQL}`;
  const [totals, causes, top, login, retries, work, sessions, loops, daily, perService] = await Promise.all([
    pool.query<{ total: string; incomplete: string; test: string; test_failed: string }>(
      `SELECT COUNT(*) FILTER (WHERE NOT ${TEST_SQL})::text AS total,
              COUNT(*) FILTER (WHERE NOT ${TEST_SQL} AND ${FAILED_SQL})::text AS incomplete,
              COUNT(*) FILTER (WHERE ${TEST_SQL})::text AS test,
              COUNT(*) FILTER (WHERE ${TEST_SQL} AND ${FAILED_SQL})::text AS test_failed
       FROM api_events e WHERE ${baseScope}`,
      p
    ),
    pool.query<{ cause: FailureCause; n: string; users: string }>(
      `SELECT ${CAUSE_SQL} AS cause, COUNT(*)::text AS n, COUNT(DISTINCT ${USER_SQL})::text AS users
       FROM api_events e WHERE ${scope} AND ${FAILED_SQL} GROUP BY 1`,
      p
    ),
    pool.query<{ cause: FailureCause; method: string; path: string; n: string; status: number | null }>(
      `SELECT * FROM (
         SELECT ${CAUSE_SQL} AS cause, COALESCE(e.http_method, '') AS method, ${ENDPOINT_GROUP_SQL} AS path,
                COUNT(*)::text AS n, MODE() WITHIN GROUP (ORDER BY e.status_code) AS status,
                ROW_NUMBER() OVER (PARTITION BY ${CAUSE_SQL} ORDER BY COUNT(*) DESC) AS rn
         FROM api_events e WHERE ${scope} AND ${FAILED_SQL} GROUP BY 1, 2, 3
       ) x WHERE rn <= 3`,
      p
    ),
    pool.query<{ attempts: string; failed: string; users_failed: string; users_repeat: string }>(
      `WITH l AS (
         SELECT ${USER_SQL} AS user_key, ${FAILED_SQL} AS failed
         FROM api_events e
         WHERE ${scope} AND UPPER(COALESCE(e.http_method, '')) = 'POST'
           AND e.endpoint ~* '(^|/)(login|signin|sign-in)(/|$|\\?)'
       ), per AS (SELECT user_key, COUNT(*) FILTER (WHERE failed) AS f FROM l GROUP BY 1)
       SELECT (SELECT COUNT(*) FROM l)::text AS attempts,
              (SELECT COUNT(*) FROM l WHERE failed)::text AS failed,
              (SELECT COUNT(*) FROM per WHERE f > 0)::text AS users_failed,
              (SELECT COUNT(*) FROM per WHERE f >= 3)::text AS users_repeat`,
      p
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM (
         SELECT e.occurred_at - LAG(e.occurred_at) OVER (
                  PARTITION BY e.session_id, e.http_method, ${ENDPOINT_GROUP_SQL} ORDER BY e.occurred_at) AS gap
         FROM api_events e WHERE ${scope} AND ${FAILED_SQL} AND e.session_id IS NOT NULL
       ) x WHERE gap IS NOT NULL AND gap <= interval '2 minutes'`,
      p
    ),
    pool.query<{ sessions: string; users: string }>(
      `SELECT COUNT(DISTINCT e.session_id)::text AS sessions, COUNT(DISTINCT ${USER_SQL})::text AS users
       FROM api_events e
       WHERE ${scope} AND NOT ${FAILED_SQL} AND e.endpoint !~* '${AUTH_PATH_RE}'`,
      p
    ),
    pool.query<{ sessions: string; users: string }>(
      `SELECT COUNT(*)::text AS sessions,
              COUNT(DISTINCT COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''), session_id))::text AS users
       FROM user_sessions WHERE project_id = $1 AND ended_at >= $2 AND started_at <= $3`,
      p
    ),
    pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM (
         SELECT a.session_id FROM session_actions a
         WHERE a.project_id = $1 AND a.occurred_at >= $2 AND a.occurred_at <= $3 AND ${navKindSql("a")}
           AND ${screenLabelSql("a")} ~* '(log ?in|sign ?in)'
         GROUP BY a.session_id HAVING COUNT(*) >= 2
       ) x`,
      p
    ),
    pool.query<{ day: string; server: string; auth: string; client: string }>(
      `SELECT to_char(date_trunc('day', e.occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
              COUNT(*) FILTER (WHERE ${CAUSE_SQL} IN ('server', 'network'))::text AS server,
              COUNT(*) FILTER (WHERE ${CAUSE_SQL} = 'auth')::text AS auth,
              COUNT(*) FILTER (WHERE ${CAUSE_SQL} = 'client')::text AS client
       FROM api_events e WHERE ${scope} AND ${FAILED_SQL} GROUP BY 1 ORDER BY 1`,
      p
    ),
    pool.query<{
      service: string;
      total: string;
      incomplete: string;
      svc: string;
      cli: string;
      nostatus: string;
      p50: string | null;
      p95: string | null;
      p99: string | null;
      users: string;
      affected: string;
    }>(
      `SELECT e.service, COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE ${FAILED_SQL})::text AS incomplete,
              COUNT(*) FILTER (WHERE ${FAILED_SQL} AND ${CAUSE_SQL} IN ('server', 'network'))::text AS svc,
              COUNT(*) FILTER (WHERE ${FAILED_SQL} AND ${CAUSE_SQL} IN ('auth', 'client'))::text AS cli,
              COUNT(*) FILTER (WHERE ${FAILED_SQL} AND ${CAUSE_SQL} = 'unclassified')::text AS nostatus,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY e.latency_ms)::text AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY e.latency_ms)::text AS p95,
              percentile_cont(0.99) WITHIN GROUP (ORDER BY e.latency_ms)::text AS p99,
              COUNT(DISTINCT ${USER_SQL})::text AS users,
              COUNT(DISTINCT ${USER_SQL}) FILTER (WHERE ${FAILED_SQL})::text AS affected
       FROM api_events e WHERE ${scope}
       GROUP BY 1 ORDER BY COUNT(*) DESC`,
      p
    ),
  ]);

  const total = Number(totals.rows[0]?.total ?? 0);
  const incomplete = Number(totals.rows[0]?.incomplete ?? 0);
  const order: FailureCause[] = ["auth", "client", "server", "network", "unclassified"];
  const causeRows: CauseRow[] = order.map((cause) => {
    const r = causes.rows.find((x) => x.cause === cause);
    const count = Number(r?.n ?? 0);
    return {
      cause,
      label: CAUSE_LABEL[cause],
      meaning: CAUSE_MEANING[cause],
      count,
      users: Number(r?.users ?? 0),
      share: incomplete ? count / incomplete : 0,
      topEndpoints: top.rows
        .filter((t) => t.cause === cause)
        .map((t) => ({ method: t.method, path: t.path || "/", count: Number(t.n), status: t.status })),
    };
  });
  const count = (c: FailureCause) => causeRows.find((r) => r.cause === c)!.count;
  const serviceFailures = count("server") + count("network");
  const l = login.rows[0]!;
  return {
    totalRequests: total,
    incomplete,
    causes: causeRows,
    serviceFailureRate: total ? serviceFailures / total : 0,
    serviceFailureRateUpper: total ? (serviceFailures + count("unclassified")) / total : 0,
    testTraffic: { requests: Number(totals.rows[0]?.test ?? 0), failed: Number(totals.rows[0]?.test_failed ?? 0) },
    serviceAvailability: total ? 1 - serviceFailures / total : 1,
    clientRejectionRate: total ? (count("auth") + count("client")) / total : 0,
    login: {
      attempts: Number(l.attempts),
      failed: Number(l.failed),
      usersFailed: Number(l.users_failed),
      usersFailedRepeatedly: Number(l.users_repeat),
    },
    retryFailures: Number(retries.rows[0]?.n ?? 0),
    sessionsTotal: Number(sessions.rows[0]?.sessions ?? 0),
    sessionsCompletedWork: Number(work.rows[0]?.sessions ?? 0),
    usersTotal: Number(sessions.rows[0]?.users ?? 0),
    usersCompletedWork: Number(work.rows[0]?.users ?? 0),
    loginLoopSessions: Number(loops.rows[0]?.n ?? 0),
    byService: perService.rows.map((r) => {
      const n = Number(r.total);
      const num = (v: string | null) => (v == null ? null : Math.round(Number(v)));
      return {
        service: r.service,
        requests: n,
        incomplete: Number(r.incomplete),
        serviceFailures: Number(r.svc),
        clientRejections: Number(r.cli),
        noStatus: Number(r.nostatus),
        availability: n ? 1 - Number(r.svc) / n : 1,
        incompleteRate: n ? Number(r.incomplete) / n : 0,
        p50Ms: num(r.p50),
        p95Ms: num(r.p95),
        p99Ms: num(r.p99),
        users: Number(r.users),
        usersAffected: Number(r.affected),
      };
    }),
    daily: daily.rows.map((d) => ({
      date: d.day,
      serviceFailures: Number(d.server),
      authFailures: Number(d.auth),
      clientFailures: Number(d.client),
    })),
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Classify one problem row (status + path) the same way CAUSE_SQL does. */
export function causeOf(statusCode: number | null | undefined, path: string, networkHint = false): FailureCause {
  const s = statusCode ?? 0;
  if (s >= 500) return "server";
  if ([401, 403, 407, 419, 440].includes(s) || (s >= 400 && new RegExp(AUTH_PATH_RE, "i").test(path))) return "auth";
  if (s >= 400) return "client";
  return networkHint ? "network" : "unclassified";
}

export type RetentionDay = { date: string; users: number; returned1d: number; returned7d: number };

export type RetentionAssessment = {
  /** Cohorts with users whose next-day window has been fully observed. */
  d1Cohorts: number;
  d1Users: number;
  d1Rate: number | null;
  d7Cohorts: number;
  d7Users: number;
  d7Rate: number | null;
  /** Share of the period's days that have any cohort data. */
  coverage: number;
  firstCohort: string | null;
  lastCohort: string | null;
  /** Enough data to state a period-wide retention figure. */
  representative: boolean;
  reason: string;
  weekly: { week: string; users: number; d1Rate: number | null; d7Rate: number | null; small: boolean }[];
};

export const MIN_COHORT_USERS = 30;
const MIN_COHORTS = 14;
const MIN_TOTAL_USERS = 300;
const MIN_COVERAGE = 0.5;

function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * User-weighted D1/D7 over cohorts whose return window has actually been observed
 * (dataEnd), plus a verdict on whether the sample can speak for the whole period.
 */
export function assessRetention(days: RetentionDay[], dataEnd: Date): RetentionAssessment {
  const withUsers = days.filter((d) => d.users > 0).sort((a, b) => a.date.localeCompare(b.date));
  const endMs = dataEnd.getTime();
  const observed = (date: string, plusDays: number) => Date.parse(`${date}T00:00:00Z`) + (plusDays + 1) * 86400_000 <= endMs;
  const d1 = withUsers.filter((d) => observed(d.date, 1));
  const d7 = withUsers.filter((d) => observed(d.date, 7));
  const sum = (rows: RetentionDay[], k: "users" | "returned1d" | "returned7d") => rows.reduce((s, r) => s + r[k], 0);
  const d1Users = sum(d1, "users");
  const d7Users = sum(d7, "users");

  const weeks = new Map<string, RetentionDay[]>();
  for (const d of withUsers) {
    const w = mondayOf(d.date);
    weeks.set(w, [...(weeks.get(w) ?? []), d]);
  }
  const weekly = [...weeks.entries()].map(([week, rows]) => {
    const r1 = rows.filter((r) => observed(r.date, 1));
    const r7 = rows.filter((r) => observed(r.date, 7));
    const u1 = sum(r1, "users");
    const u7 = sum(r7, "users");
    const users = sum(rows, "users");
    return {
      week,
      users,
      d1Rate: u1 ? sum(r1, "returned1d") / u1 : null,
      d7Rate: u7 ? sum(r7, "returned7d") / u7 : null,
      small: users < MIN_COHORT_USERS,
    };
  });

  const coverage = days.length ? withUsers.length / days.length : 0;
  const problems: string[] = [];
  if (d1.length < MIN_COHORTS) problems.push(`only ${d1.length} daily cohort${d1.length === 1 ? "" : "s"} have an observed next day`);
  if (d1Users < MIN_TOTAL_USERS) problems.push(`only ${d1Users} users are in those cohorts`);
  if (coverage < MIN_COVERAGE) problems.push(`cohort data covers ${(coverage * 100).toFixed(0)}% of the period's days`);
  return {
    d1Cohorts: d1.length,
    d1Users,
    d1Rate: d1Users ? sum(d1, "returned1d") / d1Users : null,
    d7Cohorts: d7.length,
    d7Users,
    d7Rate: d7Users ? sum(d7, "returned7d") / d7Users : null,
    coverage,
    firstCohort: withUsers[0]?.date ?? null,
    lastCohort: withUsers[withUsers.length - 1]?.date ?? null,
    representative: problems.length === 0,
    reason: problems.join("; "),
    weekly,
  };
}

export type ScreenFlag = "unnamed" | "generic" | "auth" | "duplicate" | "id-route";

const GENERIC_SCREENS = /^(\/|home|index|main|root|dashboard|dashboard access|dcc dashboard access|app|screen|tabs?)$/i;
const AUTH_SCREEN = /(log ?in|sign ?in|auth|otp|verify|setup)/i;

function baseName(screen: string): string {
  return screen
    .toLowerCase()
    .replace(/\b(screen|setup|page|view)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Flag screen names that look like instrumentation artifacts rather than distinct
 * product screens: unnamed/unknown, generic shells, auth/redirect screens, near
 * duplicates ("Login Screen" vs "Login Screen Setup") and raw id routes.
 */
export function flagScreens(screens: string[]): Map<string, ScreenFlag[]> {
  const out = new Map<string, ScreenFlag[]>();
  const bases = new Map<string, string[]>();
  for (const s of screens) {
    const b = baseName(s || "");
    if (b) bases.set(b, [...(bases.get(b) ?? []), s]);
  }
  for (const s of screens) {
    const flags: ScreenFlag[] = [];
    const name = (s || "").trim();
    if (!name || /unknown/i.test(name)) flags.push("unnamed");
    else {
      const clean = name.replace(/^\//, "") || "/";
      if (GENERIC_SCREENS.test(name) || GENERIC_SCREENS.test(clean)) flags.push("generic");
      if (AUTH_SCREEN.test(name)) flags.push("auth");
      if ((bases.get(baseName(name))?.length ?? 0) > 1) flags.push("duplicate");
      if (/\/[a-z0-9]{20,}(\/|$)/i.test(name) || /^\/?c[a-z0-9]{20,}$/i.test(name)) flags.push("id-route");
    }
    if (flags.length) out.set(s, flags);
  }
  return out;
}

export const SCREEN_FLAG_LABEL: Record<ScreenFlag, string> = {
  unnamed: "Unnamed",
  generic: "Generic shell",
  auth: "Auth / redirect",
  duplicate: "Duplicate name",
  "id-route": "Raw id route",
};

/** Journeys that leave and return to a login screen: usually auth redirects or failed sign-in loops. */
export function isLoginLoop(path: string[]): boolean {
  const idx = path.map((s, i) => (AUTH_SCREEN.test(s) && /log ?in|sign ?in/i.test(s) ? i : -1)).filter((i) => i >= 0);
  return idx.length >= 2 && idx[idx.length - 1]! - idx[0]! >= 2;
}
