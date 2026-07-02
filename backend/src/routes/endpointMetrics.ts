import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireJwt } from "../middleware/jwt.js";
import { createHash } from "crypto";

const listQuery = z.object({
  window: z.enum(["1h", "6h", "24h", "7d"]).optional(),
  app_service: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const WINDOWS: Record<string, string> = {
  "1h": "1 hour",
  "6h": "6 hours",
  "24h": "24 hours",
  "7d": "7 days",
};

function endpointKey(requestUrl: string | null, endpoint: string): string {
  const base = requestUrl ?? endpoint;
  return createHash("sha256").update(base).digest("hex").slice(0, 16);
}

export function endpointMetricsRouter(pool: Pool): IRouter {
  const r = Router();

  r.get("/endpoints/metrics", requireJwt, async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const q = parsed.data;
    const windowId = q.window ?? "24h";
    const interval = WINDOWS[windowId] ?? "24 hours";
    const limit = q.limit ?? 100;

    const params: unknown[] = [interval];
    let serviceFilter = "";
    if (q.app_service) {
      serviceFilter = `AND app_service = $2`;
      params.push(q.app_service);
    }

    const result = await pool.query<{
      request_url: string | null;
      endpoint: string;
      app_service: string | null;
      success_count: string;
      failure_count: string;
      other_count: string;
      unique_users: string;
      unique_sessions: string;
      last_failure_at: Date | null;
    }>(
      `SELECT
         COALESCE(request_url, endpoint) AS request_url,
         MIN(endpoint) AS endpoint,
         MIN(app_service) AS app_service,
         COUNT(*) FILTER (WHERE outcome = 'SUCCESS')::text AS success_count,
         COUNT(*) FILTER (WHERE outcome = 'FAILURE')::text AS failure_count,
         COUNT(*) FILTER (WHERE outcome = 'OTHER')::text AS other_count,
         COUNT(DISTINCT user_email) FILTER (WHERE user_email IS NOT NULL AND user_email <> '')::text AS unique_users,
         COUNT(DISTINCT session_id) FILTER (WHERE session_id IS NOT NULL)::text AS unique_sessions,
         MAX(occurred_at) FILTER (WHERE outcome IN ('FAILURE', 'OTHER')) AS last_failure_at
       FROM api_events
       WHERE occurred_at >= now() - $1::interval ${serviceFilter}
       GROUP BY COALESCE(request_url, endpoint)
       ORDER BY (COUNT(*) FILTER (WHERE outcome IN ('FAILURE', 'OTHER'))) DESC, COUNT(*) DESC
       LIMIT ${limit}`,
      params
    );

    res.json({
      window: windowId,
      endpoints: result.rows.map((row) => {
        const url = row.request_url ?? row.endpoint;
        const total =
          Number(row.success_count) +
          Number(row.failure_count) +
          Number(row.other_count);
        return {
          endpoint_key: endpointKey(row.request_url, row.endpoint),
          request_url: url,
          endpoint: row.endpoint,
          app_service: row.app_service,
          success_count: Number(row.success_count),
          failure_count: Number(row.failure_count),
          other_count: Number(row.other_count),
          total_count: total,
          success_rate: total > 0 ? Number(row.success_count) / total : 0,
          unique_users: Number(row.unique_users),
          unique_sessions: Number(row.unique_sessions),
          last_failure_at: row.last_failure_at
            ? row.last_failure_at.toISOString()
            : null,
        };
      }),
    });
  });

  r.get("/endpoints/metrics/:endpointKey", requireJwt, async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    const windowId = parsed.success ? (parsed.data.window ?? "24h") : "24h";
    const interval = WINDOWS[windowId] ?? "24 hours";
    const key = req.params.endpointKey;

    const failures = await pool.query(
      `SELECT id::text, session_id, user_email, user_id, status_code, outcome, failure_reason,
              occurred_at, request_url, endpoint, app_service
       FROM api_events
       WHERE occurred_at >= now() - $1::interval
         AND outcome IN ('FAILURE', 'OTHER')
         AND substring(encode(digest(COALESCE(request_url, endpoint), 'sha256'), 'hex') from 1 for 16) = $2
       ORDER BY occurred_at DESC
       LIMIT 50`,
      [interval, key]
    );

    if (failures.rows.length === 0) {
      res.status(404).json({ error: "No failures for this endpoint in window" });
      return;
    }

    res.json({
      window: windowId,
      endpoint_key: key,
      failures: failures.rows.map((row) => ({
        id: row.id,
        session_id: row.session_id,
        user_email: row.user_email,
        user_id: row.user_id,
        status_code: row.status_code,
        outcome: row.outcome,
        failure_reason: row.failure_reason,
        occurred_at: (row.occurred_at as Date).toISOString(),
        request_url: row.request_url,
        endpoint: row.endpoint,
        app_service: row.app_service,
      })),
    });
  });

  return r;
}
