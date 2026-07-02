import type { Pool } from "pg";
import { config } from "../config.js";
import {
  errorRateToDisplayStatus,
  type DisplayStatus,
} from "./slidingWindow.js";

export type ApiOutcome = "SUCCESS" | "FAILURE" | "OTHER";

export type TrackedApiHealthRow = {
  id: string;
  label: string;
  base_url: string;
  status: DisplayStatus;
  error_rate_5m: number;
  last_seen: string | null;
  last_outcome: ApiOutcome | null;
};

type Def = { id: string; label: string; baseUrl: string };

function pgCode(e: unknown): string | undefined {
  return (e as { code?: string })?.code;
}

/** Safe false on missing column/table; rethrow unexpected errors. */
async function columnExists(pool: Pool, name: string): Promise<boolean> {
  try {
    await pool.query(`SELECT ${name} FROM public.api_events LIMIT 0`);
    return true;
  } catch (e: unknown) {
    const c = pgCode(e);
    if (c === "42703" || c === "42P01") return false;
    throw e;
  }
}

let warnedSchemaMismatch = false;

function warnSchemaOnce(message: string): void {
  if (warnedSchemaMismatch) return;
  warnedSchemaMismatch = true;
  console.warn(`[tracked-apis] ${message}`);
}

function definitions(): Def[] {
  const u = config.trackedApiUrls;
  return [
    { id: "koralink_main", label: "Koralink main API", baseUrl: u.koralink },
    {
      id: "gwiza_mvend",
      label: "Gwiza / MVEND (digital svc)",
      baseUrl: u.gwiza,
    },
    {
      id: "ddin_agency",
      label: "DDIN (DIGITAL_SERVICES_BASE_URL)",
      baseUrl: u.ddin,
    },
    {
      id: "tickets_resolveit",
      label: "Tickets (TICKETS_BASE_URL)",
      baseUrl: u.tickets,
    },
  ];
}

function hostLikePattern(baseUrl: string): string {
  try {
    const h = new URL(baseUrl).hostname;
    return `%${h}%`;
  } catch {
    return `%${baseUrl.replace(/^https?:\/\//, "").split("/")[0]}%`;
  }
}

function parseOutcome(lo: string | null): ApiOutcome | null {
  return lo === "SUCCESS" || lo === "FAILURE" || lo === "OTHER" ? lo : null;
}

const EMPTY_METRICS = {
  error_rate_5m: 0,
  last_seen: null as string | null,
  last_outcome: null as ApiOutcome | null,
};

/**
 * Uses `public.api_events` and columns from the shipped migrations.
 * If the table/columns differ (wrong DB, partial migrate), returns empty metrics instead of throwing.
 */
async function metricsForTracked(
  pool: Pool,
  d: Def,
  flags: { upstream_key: boolean; request_url: boolean; status_code: boolean }
): Promise<{
  error_rate_5m: number;
  last_seen: string | null;
  last_outcome: ApiOutcome | null;
}> {
  if (!flags.status_code || !flags.request_url) {
    warnSchemaOnce(
      "public.api_events is missing status_code and/or request_url — " +
        "tracked metrics disabled until migrations match this DATABASE_URL (npm run db:migrate)."
    );
    return EMPTY_METRICS;
  }

  const hostPat = hostLikePattern(d.baseUrl);

  const scopeKey = flags.upstream_key
    ? `(upstream_key = $1 OR (request_url IS NOT NULL AND request_url ILIKE $2))`
    : `(request_url IS NOT NULL AND request_url ILIKE $1)`;
  const keyParams = flags.upstream_key ? [d.id, hostPat] : [hostPat];

  try {
    const r = await pool.query<{ er: string; ls: Date | null; lo: string | null }>(
      `WITH scoped AS (
         SELECT occurred_at, status_code
         FROM public.api_events
         WHERE occurred_at >= now() - interval '5 minutes'
           AND ${scopeKey}
       )
       SELECT
         CASE
           WHEN (SELECT COUNT(*)::bigint FROM scoped) = 0 THEN 0::float8
           ELSE (SELECT (COUNT(*) FILTER (WHERE status_code = 0 OR status_code >= 400))::float8
                 / NULLIF((SELECT COUNT(*)::float8 FROM scoped), 0))
         END AS er,
         (SELECT MAX(occurred_at) FROM public.api_events WHERE ${scopeKey}) AS ls,
         (SELECT CASE
            WHEN status_code = 0 THEN 'OTHER'
            WHEN status_code >= 200 AND status_code < 300 THEN 'SUCCESS'
            ELSE 'FAILURE'
          END::text FROM public.api_events
          WHERE ${scopeKey}
          ORDER BY occurred_at DESC LIMIT 1) AS lo`,
      keyParams
    );
    const row = r.rows[0];
    return {
      error_rate_5m: Number(row?.er ?? 0),
      last_seen: row?.ls ? row.ls.toISOString() : null,
      last_outcome: parseOutcome(row?.lo ?? null),
    };
  } catch (e: unknown) {
    const c = pgCode(e);
    if (c === "42703" || c === "42P01") {
      warnSchemaOnce(
        `Query failed (${c}): ${(e as Error).message} — returning empty tracked metrics.`
      );
      return EMPTY_METRICS;
    }
    throw e;
  }
}

export async function listTrackedApisHealth(pool: Pool): Promise<
  TrackedApiHealthRow[]
> {
  const tableOk = await columnExists(pool, "occurred_at");
  if (!tableOk) {
    warnSchemaOnce(
      "public.api_events not found or missing occurred_at — run npm run db:migrate on this database."
    );
    return definitions().map((d) => ({
      id: d.id,
      label: d.label,
      base_url: d.baseUrl,
      status: errorRateToDisplayStatus(0),
      error_rate_5m: 0,
      last_seen: null,
      last_outcome: null,
    }));
  }

  const [upstream_key, request_url, status_code] = await Promise.all([
    columnExists(pool, "upstream_key"),
    columnExists(pool, "request_url"),
    columnExists(pool, "status_code"),
  ]);

  const flags = { upstream_key, request_url, status_code };

  const out: TrackedApiHealthRow[] = [];
  for (const d of definitions()) {
    const m = await metricsForTracked(pool, d, flags);
    out.push({
      id: d.id,
      label: d.label,
      base_url: d.baseUrl,
      status: errorRateToDisplayStatus(m.error_rate_5m),
      error_rate_5m: m.error_rate_5m,
      last_seen: m.last_seen,
      last_outcome: m.last_outcome,
    });
  }
  return out;
}
