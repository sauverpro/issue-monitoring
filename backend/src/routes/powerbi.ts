import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireAnalystAuth } from "../middleware/analystAuth.js";

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const csvRows: string[] = [];
  csvRows.push(headers.join(","));
  for (const row of rows) {
    const values = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return '""';
      if (val instanceof Date) return `"${val.toISOString()}"`;
      if (typeof val === "object") return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
      const str = String(val);
      return `"${str.replace(/"/g, '""')}"`;
    });
    csvRows.push(values.join(","));
  }
  return csvRows.join("\n");
}

function respond<T extends Record<string, unknown>>(
  res: any,
  data: T[] | Record<string, unknown>,
  format: string | undefined,
  filename: string
) {
  if (format?.toLowerCase() === "csv") {
    const list = Array.isArray(data) ? data : [data];
    const csv = toCsv(list);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.status(200).send(csv);
    return;
  }
  res.json(data);
}

const windowSchema = z.enum(["1h", "6h", "24h", "7d", "30d"]).default("24h");
const WINDOWS_SQL: Record<string, string> = {
  "1h": "1 hour",
  "6h": "6 hours",
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

export function powerbiRouter(pool: Pool): IRouter {
  const r = Router();

  r.use(["/api/powerbi", "/powerbi"], requireAnalystAuth);

  /**
   * 1. High-Level Executive KPI Summary (PowerBI Cards & Dashboards)
   * GET /api/powerbi/summary?window=24h&format=json|csv
   */
  r.get(["/api/powerbi/summary", "/powerbi/summary"], async (req, res) => {
    try {
      const windowId = windowSchema.parse(req.query.window);
      const interval = WINDOWS_SQL[windowId] ?? "24 hours";

      const summarySql = `
        SELECT
          COUNT(*)::int AS total_requests,
          COUNT(CASE WHEN outcome = 'SUCCESS' THEN 1 END)::int AS success_count,
          COUNT(CASE WHEN outcome = 'FAILURE' THEN 1 END)::int AS failure_count,
          COUNT(CASE WHEN outcome = 'OTHER' THEN 1 END)::int AS other_count,
          COUNT(DISTINCT COALESCE(user_id, user_email))::int AS unique_users,
          COUNT(DISTINCT session_id)::int AS unique_sessions
        FROM api_events
        WHERE occurred_at >= now() - $1::interval
      `;
      const sRes = await pool.query(summarySql, [interval]);
      const s = sRes.rows[0] ?? {};

      const total = s.total_requests ?? 0;
      const success = s.success_count ?? 0;
      const failure = s.failure_count ?? 0;
      const other = s.other_count ?? 0;
      const successRatePct = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 100;
      const errorRatePct = total > 0 ? Number(((failure / total) * 100).toFixed(2)) : 0;

      const incSql = `SELECT COUNT(*)::int AS open_incidents FROM incidents WHERE status != 'resolved'`;
      const incRes = await pool.query(incSql);
      const openIncidents = incRes.rows[0]?.open_incidents ?? 0;

      const failedSessSql = `
        SELECT COUNT(*)::int AS failed_sessions
        FROM user_sessions
        WHERE ended_at >= now() - $1::interval AND failure_events > 0
      `;
      const fSessRes = await pool.query(failedSessSql, [interval]);
      const failedSessions = fSessRes.rows[0]?.failed_sessions ?? 0;

      const result = {
        window: windowId,
        generatedAt: new Date().toISOString(),
        totalRequests: total,
        successCount: success,
        failureCount: failure,
        otherCount: other,
        successRatePct,
        errorRatePct,
        uniqueUsers: s.unique_users ?? 0,
        uniqueSessions: s.unique_sessions ?? 0,
        failedSessions,
        openIncidents,
      };

      respond(res, result, req.query.format as string, `powerbi_summary_${windowId}`);
    } catch (err) {
      console.error("[powerbi] Summary query error", err);
      res.status(500).json({ error: "Failed to generate PowerBI summary" });
    }
  });

  /**
   * 2. Granular API Events Telemetry Feed (PowerBI Fact Table)
   * GET /api/powerbi/events?startDate=...&endDate=...&service=DDIN|MVEND&outcome=SUCCESS|FAILURE&limit=1000&format=json|csv
   */
  r.get(["/api/powerbi/events", "/powerbi/events"], async (req, res) => {
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 500), 5000);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (req.query.service) {
        conditions.push(`service = $${idx++}`);
        params.push(String(req.query.service).toUpperCase());
      }
      if (req.query.outcome) {
        conditions.push(`outcome = $${idx++}`);
        params.push(String(req.query.outcome).toUpperCase());
      }
      if (req.query.startDate) {
        conditions.push(`occurred_at >= $${idx++}`);
        params.push(new Date(String(req.query.startDate)).toISOString());
      }
      if (req.query.endDate) {
        conditions.push(`occurred_at <= $${idx++}`);
        params.push(new Date(String(req.query.endDate)).toISOString());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const querySql = `
        SELECT
          id::text,
          occurred_at AS "occurredAt",
          service,
          app_service AS "appService",
          endpoint,
          request_url AS "requestUrl",
          status_code AS "statusCode",
          latency_ms AS "latencyMs",
          outcome,
          source,
          session_id AS "sessionId",
          user_id AS "userId",
          user_email AS "userEmail",
          user_role AS "userRole",
          account_type AS "accountType",
          failure_reason AS "failureReason",
          upstream_key AS "upstreamKey"
        FROM api_events
        ${whereClause}
        ORDER BY occurred_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `;

      const result = await pool.query(querySql, [...params, limit, offset]);

      const formatted = result.rows.map((row) => ({
        ...row,
        occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : null,
      }));

      respond(res, formatted, req.query.format as string, "powerbi_events");
    } catch (err) {
      console.error("[powerbi] Events feed error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI events feed" });
    }
  });

  /**
   * 3. User Session Performance Feed (PowerBI Sessions Dimension Table)
   * GET /api/powerbi/sessions?hasFailures=true&limit=500&format=json|csv
   */
  r.get(["/api/powerbi/sessions", "/powerbi/sessions"], async (req, res) => {
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 500), 5000);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (req.query.hasFailures === "true") {
        conditions.push(`failure_events > 0`);
      }
      if (req.query.userEmail) {
        conditions.push(`user_email ILIKE $${idx++}`);
        params.push(`%${req.query.userEmail}%`);
      }
      if (req.query.startDate) {
        conditions.push(`started_at >= $${idx++}`);
        params.push(new Date(String(req.query.startDate)).toISOString());
      }
      if (req.query.endDate) {
        conditions.push(`ended_at <= $${idx++}`);
        params.push(new Date(String(req.query.endDate)).toISOString());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const querySql = `
        SELECT
          session_id AS "sessionId",
          user_id AS "userId",
          user_email AS "userEmail",
          role,
          account_type AS "accountType",
          started_at AS "startedAt",
          ended_at AS "endedAt",
          total_events AS "totalEvents",
          failure_events AS "failureEvents",
          distinct_endpoints AS "distinctEndpoints"
        FROM user_sessions
        ${whereClause}
        ORDER BY ended_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `;

      const result = await pool.query(querySql, [...params, limit, offset]);

      const formatted = result.rows.map((row) => {
        const total = row.totalEvents ?? 0;
        const failures = row.failureEvents ?? 0;
        const failureRatePct = total > 0 ? Number(((failures / total) * 100).toFixed(2)) : 0;
        return {
          sessionId: row.sessionId,
          userId: row.userId,
          userEmail: row.userEmail,
          role: row.role,
          accountType: row.accountType,
          startedAt: row.startedAt ? new Date(row.startedAt).toISOString() : null,
          endedAt: row.endedAt ? new Date(row.endedAt).toISOString() : null,
          totalEvents: total,
          failureEvents: failures,
          failureRatePct,
          distinctEndpoints: row.distinctEndpoints ?? 0,
          status: failures > 0 ? "has_failures" : "healthy",
        };
      });

      respond(res, formatted, req.query.format as string, "powerbi_sessions");
    } catch (err) {
      console.error("[powerbi] Sessions feed error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI sessions feed" });
    }
  });

  /**
   * 4. Integrated & Upstream API Health SLA Table (PowerBI Vendor Report)
   * GET /api/powerbi/upstream-health?window=24h&format=json|csv
   */
  r.get(["/api/powerbi/upstream-health", "/powerbi/upstream-health"], async (req, res) => {
    try {
      const windowId = windowSchema.parse(req.query.window);
      const interval = WINDOWS_SQL[windowId] ?? "24 hours";

      const querySql = `
        SELECT
          COALESCE(upstream_key, 'unknown') AS "upstreamKey",
          service,
          COUNT(*)::int AS "totalRequests",
          COUNT(CASE WHEN outcome = 'SUCCESS' THEN 1 END)::int AS "successCount",
          COUNT(CASE WHEN outcome = 'FAILURE' THEN 1 END)::int AS "failureCount",
          COUNT(CASE WHEN outcome = 'OTHER' THEN 1 END)::int AS "otherCount",
          COUNT(DISTINCT COALESCE(user_id, user_email))::int AS "uniqueUsers",
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms)::int AS "p50Ms",
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)::int AS "p95Ms",
          MAX(occurred_at) AS "lastSeen"
        FROM api_events
        WHERE occurred_at >= now() - $1::interval
        GROUP BY COALESCE(upstream_key, 'unknown'), service
        ORDER BY "totalRequests" DESC
      `;

      const result = await pool.query(querySql, [interval]);

      const formatted = result.rows.map((row) => {
        const total = row.totalRequests ?? 0;
        const failures = row.failureCount ?? 0;
        const success = row.successCount ?? 0;
        const errorRatePct = total > 0 ? Number(((failures / total) * 100).toFixed(2)) : 0;
        const successRatePct = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 100;
        return {
          upstreamKey: row.upstreamKey,
          service: row.service,
          totalRequests: total,
          successCount: success,
          failureCount: failures,
          otherCount: row.otherCount ?? 0,
          successRatePct,
          errorRatePct,
          p50Ms: row.p50Ms ?? 0,
          p95Ms: row.p95Ms ?? 0,
          uniqueUsers: row.uniqueUsers ?? 0,
          lastSeen: row.lastSeen ? new Date(row.lastSeen).toISOString() : null,
          status: errorRatePct > 5 ? "degraded" : "operational",
        };
      });

      respond(res, formatted, req.query.format as string, `powerbi_upstreams_${windowId}`);
    } catch (err) {
      console.error("[powerbi] Upstream health error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI upstream health feed" });
    }
  });

  /**
   * 5. Incident & Outage Log Feed (PowerBI SLA Log)
   * GET /api/powerbi/incidents?format=json|csv
   */
  r.get(["/api/powerbi/incidents", "/powerbi/incidents"], async (req, res) => {
    try {
      const querySql = `
        SELECT
          i.id::text,
          i.service,
          i.title,
          i.severity,
          i.status,
          i.opened_at AS "openedAt",
          i.resolved_at AS "resolvedAt",
          i.trigger_error_rate AS "triggerErrorRate",
          i.resolution_reason AS "resolutionReason",
          i.auto_resolved AS "autoResolved",
          COUNT(n.id)::int AS "notesCount"
        FROM incidents i
        LEFT JOIN incident_notes n ON n.incident_id = i.id
        GROUP BY i.id
        ORDER BY i.opened_at DESC
      `;

      const result = await pool.query(querySql);

      const formatted = result.rows.map((row) => {
        const opened = row.openedAt ? new Date(row.openedAt) : null;
        const resolved = row.resolvedAt ? new Date(row.resolvedAt) : null;
        const durationMinutes = opened && resolved ? Math.round((resolved.getTime() - opened.getTime()) / 60000) : null;

        return {
          id: row.id,
          service: row.service,
          title: row.title,
          severity: row.severity,
          status: row.status,
          openedAt: opened ? opened.toISOString() : null,
          resolvedAt: resolved ? resolved.toISOString() : null,
          durationMinutes,
          triggerErrorRatePct: Number(((Number(row.triggerErrorRate) || 0) * 100).toFixed(2)),
          resolutionReason: row.resolutionReason,
          autoResolved: row.autoResolved ?? false,
          notesCount: row.notesCount ?? 0,
        };
      });

      respond(res, formatted, req.query.format as string, "powerbi_incidents");
    } catch (err) {
      console.error("[powerbi] Incidents feed error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI incidents feed" });
    }
  });

  return r;
}
