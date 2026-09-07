import type { Pool } from "pg";

export type ProjectOverview = {
  hasEvents: boolean;
  sessionCount: number;
  uniqueUsers: number;
  apiCalls: number;
  success: number;
  failure: number;
  other: number;
  errorRate: number;
  byUpstream: {
    service: string;
    total: number;
    failures: number;
    errorRate: number;
    avgLatencyMs: number;
  }[];
};

export async function getProjectOverview(
  pool: Pool,
  projectId: string,
  days = 7
): Promise<ProjectOverview> {
  const interval = `${days} days`;
  const counts = await pool.query<{
    sessions: string;
    users: string;
    api: string;
    success: string;
    failure: string;
    other: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM user_sessions
         WHERE project_id = $1 AND ended_at >= now() - $2::interval) AS sessions,
       (SELECT COUNT(DISTINCT user_id)::text FROM user_sessions
         WHERE project_id = $1 AND ended_at >= now() - $2::interval AND user_id IS NOT NULL) AS users,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= now() - $2::interval) AS api,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= now() - $2::interval AND outcome = 'SUCCESS') AS success,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= now() - $2::interval AND outcome = 'FAILURE') AS failure,
       (SELECT COUNT(*)::text FROM api_events
         WHERE project_id = $1 AND occurred_at >= now() - $2::interval AND outcome = 'OTHER') AS other`,
    [projectId, interval]
  );
  const c = counts.rows[0]!;
  const apiCalls = Number(c.api);
  const failure = Number(c.failure);
  const other = Number(c.other);
  const success = Number(c.success);

  const by = await pool.query<{
    service: string;
    total: string;
    failures: string;
    avg_latency: string | null;
  }>(
    `SELECT service,
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE outcome IN ('FAILURE', 'OTHER'))::text AS failures,
            AVG(latency_ms)::text AS avg_latency
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= now() - $2::interval
     GROUP BY service
     ORDER BY COUNT(*) DESC`,
    [projectId, interval]
  );

  return {
    hasEvents: apiCalls > 0 || Number(c.sessions) > 0,
    sessionCount: Number(c.sessions),
    uniqueUsers: Number(c.users),
    apiCalls,
    success,
    failure,
    other,
    errorRate: apiCalls === 0 ? 0 : (failure + other) / apiCalls,
    byUpstream: by.rows.map((r) => {
      const total = Number(r.total);
      const failures = Number(r.failures);
      return {
        service: r.service,
        total,
        failures,
        errorRate: total === 0 ? 0 : failures / total,
        avgLatencyMs: r.avg_latency ? Math.round(Number(r.avg_latency)) : 0,
      };
    }),
  };
}

export async function getProjectApiStats(pool: Pool, projectId: string, days = 7) {
  const q = await pool.query<{
    service: string;
    host: string | null;
    total: string;
    success: string;
    failure: string;
    other: string;
    avg_latency: string | null;
  }>(
    `SELECT service,
            (regexp_match(COALESCE(request_url, ''), 'https?://([^/]+)'))[1] AS host,
            COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::text AS success,
            COUNT(*) FILTER (WHERE outcome = 'FAILURE')::text AS failure,
            COUNT(*) FILTER (WHERE outcome = 'OTHER')::text AS other,
            AVG(latency_ms)::text AS avg_latency
     FROM api_events
     WHERE project_id = $1 AND occurred_at >= now() - $2::interval
     GROUP BY service, host
     ORDER BY COUNT(*) DESC`,
    [projectId, `${days} days`]
  );
  return q.rows.map((r) => ({
    service: r.service,
    host: r.host,
    total: Number(r.total),
    success: Number(r.success),
    failure: Number(r.failure),
    other: Number(r.other),
    avgLatencyMs: r.avg_latency ? Math.round(Number(r.avg_latency)) : 0,
  }));
}

export async function listOrgUsage(pool: Pool) {
  const q = await pool.query<{
    org_id: string;
    org_name: string;
    slug: string;
    suspended_at: Date | null;
    projects: string;
    events: string;
  }>(
    `SELECT o.id::text AS org_id, o.name AS org_name, o.slug, o.suspended_at,
            COUNT(DISTINCT p.id)::text AS projects,
            COUNT(e.id)::text AS events
     FROM organizations o
     LEFT JOIN projects p ON p.organization_id = o.id
     LEFT JOIN api_events e ON e.project_id = p.id
       AND e.occurred_at >= now() - interval '7 days'
     GROUP BY o.id, o.name, o.slug, o.suspended_at
     ORDER BY o.name`
  );
  return q.rows.map((r) => ({
    id: r.org_id,
    name: r.org_name,
    slug: r.slug,
    suspended: r.suspended_at != null,
    projectCount: Number(r.projects),
    events7d: Number(r.events),
  }));
}
