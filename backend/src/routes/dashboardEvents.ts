import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireJwt } from "../middleware/jwt.js";

const querySchema = z.object({
  service: z.enum(["DDIN", "MVEND", "KORALINK"]).optional(),
  upstream_key: z.string().optional(),
  endpoint: z.string().optional(),
  status_code: z.coerce.number().int().optional(),
  outcome: z.enum(["SUCCESS", "FAILURE", "OTHER"]).optional(),
  source: z.enum(["mobile", "web"]).optional(),
  session_id: z.string().optional(),
  user_email: z.string().optional(),
  app_service: z.string().optional(),
  sentry_type: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function buildWhere(
  q: z.infer<typeof querySchema>
): { whereSql: string; params: unknown[] } {
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];
  let i = 1;

  if (q.service) {
    conditions.push(`service = $${i++}`);
    params.push(q.service);
  }
  if (q.upstream_key) {
    conditions.push(`upstream_key = $${i++}`);
    params.push(q.upstream_key.trim().toLowerCase());
  }
  if (q.outcome) {
    conditions.push(`outcome = $${i++}`);
    params.push(q.outcome);
  }
  if (q.endpoint) {
    conditions.push(
      `(endpoint ILIKE $${i} OR COALESCE(request_url, '') ILIKE $${i})`
    );
    params.push(`%${q.endpoint}%`);
    i++;
  }
  if (q.status_code !== undefined) {
    conditions.push(`status_code = $${i++}`);
    params.push(q.status_code);
  }
  if (q.source) {
    conditions.push(`source = $${i++}`);
    params.push(q.source);
  }
  if (q.session_id) {
    conditions.push(`session_id = $${i++}`);
    params.push(q.session_id);
  }
  if (q.user_email) {
    conditions.push(`user_email ILIKE $${i++}`);
    params.push(`%${q.user_email}%`);
  }
  if (q.app_service) {
    conditions.push(`app_service = $${i++}`);
    params.push(q.app_service);
  }
  if (q.sentry_type) {
    conditions.push(`sentry_type = $${i++}`);
    params.push(q.sentry_type);
  }
  if (q.from) {
    conditions.push(`occurred_at >= $${i++}`);
    params.push(new Date(q.from).toISOString());
  }
  if (q.to) {
    conditions.push(`occurred_at <= $${i++}`);
    params.push(new Date(q.to).toISOString());
  }

  return { whereSql: conditions.join(" AND "), params };
}

export function dashboardEventsRouter(pool: Pool): IRouter {
  const r = Router();

  r.get("/events", requireJwt, async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const q = parsed.data;
    const limit = q.limit ?? 50;
    const offset = q.offset ?? 0;

    const { whereSql, params: baseParams } = buildWhere(q);
    const limitIdx = baseParams.length + 1;
    const offsetIdx = baseParams.length + 2;

    const dataSql = `
      SELECT id, service, upstream_key, outcome, endpoint, request_url, status_code, latency_ms, error_code, source, session_id, user_email, app_service, sentry_type, action_index, occurred_at, response_body
      FROM api_events
      WHERE ${whereSql}
      ORDER BY occurred_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;
    const result = await pool.query(dataSql, [...baseParams, limit, offset]);

    const countSql = `SELECT COUNT(*)::text AS c FROM api_events WHERE ${whereSql}`;
    const countR = await pool.query<{ c: string }>(countSql, baseParams);

    res.json({
      items: result.rows,
      total: Number(countR.rows[0]?.c ?? 0),
      limit,
      offset,
    });
  });

  return r;
}
