import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireJwt } from "../middleware/jwt.js";

const listQuery = z.object({
  window: z.enum(["1h", "6h", "24h", "7d"]).optional(),
  has_failures: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  app_service: z.string().optional(),
  user_email: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const WINDOWS: Record<string, string> = {
  "1h": "1 hour",
  "6h": "6 hours",
  "24h": "24 hours",
  "7d": "7 days",
};

export function sessionsRouter(pool: Pool): IRouter {
  const r = Router();

  r.get("/sessions", requireJwt, async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const q = parsed.data;
    const windowId = q.window ?? "24h";
    const interval = WINDOWS[windowId] ?? "24 hours";
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;

    const conditions = [`ended_at >= now() - $1::interval`];
    const params: unknown[] = [interval];
    let i = 2;

    if (q.has_failures) {
      conditions.push(`failure_events > 0`);
    }
    if (q.app_service) {
      conditions.push(
        `EXISTS (SELECT 1 FROM api_events e WHERE e.session_id = user_sessions.session_id AND e.app_service = $${i})`
      );
      params.push(q.app_service);
      i++;
    }
    if (q.user_email) {
      conditions.push(`user_email ILIKE $${i}`);
      params.push(`%${q.user_email}%`);
      i++;
    }

    const where = conditions.join(" AND ");
    const dataSql = `
      SELECT session_id, started_at, ended_at, last_action_index, user_id, user_email, role, account_type,
             total_events, failure_events, distinct_endpoints, updated_at
      FROM user_sessions
      WHERE ${where}
      ORDER BY ended_at DESC
      LIMIT $${i} OFFSET $${i + 1}
    `;
    const result = await pool.query(dataSql, [...params, limit, offset]);

    const countSql = `SELECT COUNT(*)::text AS c FROM user_sessions WHERE ${where}`;
    const countR = await pool.query<{ c: string }>(countSql, params);

    res.json({
      window: windowId,
      items: result.rows.map((row) => ({
        session_id: row.session_id,
        started_at: (row.started_at as Date).toISOString(),
        ended_at: (row.ended_at as Date).toISOString(),
        last_action_index: row.last_action_index,
        user_id: row.user_id,
        user_email: row.user_email,
        role: row.role,
        account_type: row.account_type,
        total_events: row.total_events,
        failure_events: row.failure_events,
        distinct_endpoints: row.distinct_endpoints,
      })),
      total: Number(countR.rows[0]?.c ?? 0),
      limit,
      offset,
    });
  });

  r.get("/sessions/:sessionId", requireJwt, async (req, res) => {
    const sessionId = req.params.sessionId;
    const summary = await pool.query(
      `SELECT session_id, started_at, ended_at, last_action_index, user_id, user_email, role, account_type,
              total_events, failure_events, distinct_endpoints
       FROM user_sessions WHERE session_id = $1`,
      [sessionId]
    );
    if (summary.rows.length === 0) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const s = summary.rows[0]!;

    const timeline = await pool.query(
      `SELECT id::text, service, app_service, upstream_key, endpoint, request_url, status_code, outcome,
              action_index, sentry_type, failure_reason, user_email, occurred_at, sentry_event_id
       FROM api_events
       WHERE session_id = $1
       ORDER BY COALESCE(action_index, 999999) ASC, occurred_at ASC`,
      [sessionId]
    );

    res.json({
      session: {
        session_id: s.session_id,
        started_at: (s.started_at as Date).toISOString(),
        ended_at: (s.ended_at as Date).toISOString(),
        last_action_index: s.last_action_index,
        user_id: s.user_id,
        user_email: s.user_email,
        role: s.role,
        account_type: s.account_type,
        total_events: s.total_events,
        failure_events: s.failure_events,
        distinct_endpoints: s.distinct_endpoints,
      },
      timeline: timeline.rows.map((row) => ({
        id: row.id,
        service: row.service,
        app_service: row.app_service,
        upstream_key: row.upstream_key,
        endpoint: row.endpoint,
        request_url: row.request_url,
        status_code: row.status_code,
        outcome: row.outcome,
        action_index: row.action_index,
        sentry_type: row.sentry_type,
        failure_reason: row.failure_reason,
        user_email: row.user_email,
        occurred_at: (row.occurred_at as Date).toISOString(),
        sentry_event_id: row.sentry_event_id,
      })),
    });
  });

  return r;
}
