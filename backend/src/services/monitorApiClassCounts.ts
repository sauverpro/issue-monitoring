import type { Pool } from "pg";
import {
  emptyApiClassCounts,
  httpResultClassSql,
  problemCount,
  type ApiClassCounts,
} from "./httpResultClass.js";

type CountRow = {
  key: string;
  success: string;
  client_failure: string;
  server_error: string;
  network: string;
};

function mapRow(r: CountRow): ApiClassCounts {
  return {
    success: Number(r.success),
    clientFailure: Number(r.client_failure),
    serverError: Number(r.server_error),
    network: Number(r.network),
  };
}

/** Per-session API outcome class counts. */
export async function apiClassCountsBySession(
  pool: Pool,
  projectId: string,
  sessionIds: string[]
): Promise<Map<string, ApiClassCounts>> {
  const out = new Map<string, ApiClassCounts>();
  if (sessionIds.length === 0) return out;
  const cls = httpResultClassSql();
  const q = await pool.query<CountRow>(
    `SELECT session_id AS key,
            COUNT(*) FILTER (WHERE (${cls}) = 'success')::text AS success,
            COUNT(*) FILTER (WHERE (${cls}) = 'client_failure')::text AS client_failure,
            COUNT(*) FILTER (WHERE (${cls}) = 'server_error')::text AS server_error,
            COUNT(*) FILTER (WHERE (${cls}) = 'network')::text AS network
     FROM api_events
     WHERE project_id = $1 AND session_id = ANY($2::text[])
     GROUP BY session_id`,
    [projectId, sessionIds]
  );
  for (const r of q.rows) out.set(r.key, mapRow(r));
  return out;
}

const USER_KEY_SQL = `COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''))`;

/** Per-user API outcome class counts over a time range (from api_events). */
export async function apiClassCountsByUser(
  pool: Pool,
  projectId: string,
  from: Date,
  to: Date,
  userKeys?: string[]
): Promise<Map<string, ApiClassCounts>> {
  const out = new Map<string, ApiClassCounts>();
  const cls = httpResultClassSql();
  const params: unknown[] = [projectId, from, to];
  let userFilter = "";
  if (userKeys && userKeys.length > 0) {
    params.push(userKeys);
    userFilter = ` AND ${USER_KEY_SQL} = ANY($4::text[])`;
  }
  const q = await pool.query<CountRow>(
    `SELECT ${USER_KEY_SQL} AS key,
            COUNT(*) FILTER (WHERE (${cls}) = 'success')::text AS success,
            COUNT(*) FILTER (WHERE (${cls}) = 'client_failure')::text AS client_failure,
            COUNT(*) FILTER (WHERE (${cls}) = 'server_error')::text AS server_error,
            COUNT(*) FILTER (WHERE (${cls}) = 'network')::text AS network
     FROM api_events
     WHERE project_id = $1
       AND occurred_at >= $2 AND occurred_at <= $3
       AND ${USER_KEY_SQL} IS NOT NULL
       ${userFilter}
     GROUP BY ${USER_KEY_SQL}`,
    params
  );
  for (const r of q.rows) {
    if (r.key) out.set(r.key, mapRow(r));
  }
  return out;
}

export async function apiClassTotals(
  pool: Pool,
  projectId: string,
  from: Date,
  to: Date
): Promise<ApiClassCounts> {
  const cls = httpResultClassSql();
  const q = await pool.query<{
    success: string;
    client_failure: string;
    server_error: string;
    network: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE (${cls}) = 'success')::text AS success,
       COUNT(*) FILTER (WHERE (${cls}) = 'client_failure')::text AS client_failure,
       COUNT(*) FILTER (WHERE (${cls}) = 'server_error')::text AS server_error,
       COUNT(*) FILTER (WHERE (${cls}) = 'network')::text AS network
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= $2 AND occurred_at <= $3`,
    [projectId, from, to]
  );
  const r = q.rows[0];
  if (!r) return emptyApiClassCounts();
  return {
    success: Number(r.success),
    clientFailure: Number(r.client_failure),
    serverError: Number(r.server_error),
    network: Number(r.network),
  };
}

export { problemCount, emptyApiClassCounts };
