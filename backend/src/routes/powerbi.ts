import { Router, type IRouter, type Request, type Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireAnalystAuth } from "../middleware/analystAuth.js";
import {
  getFunnelReport,
  getProjectPerformance,
  getProjectProblems,
  getReportBehavior,
} from "../services/monitorInsights.js";
import { getReportOverview, getReportRetention, reportQueryRange } from "../services/monitorReports.js";

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
  res: Response,
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

/** Every project-scoped Monitor endpoint requires ?projectId=; 400s with guidance if missing. */
function requireProjectId(req: Request, res: Response): string | null {
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (!projectId) {
    res.status(400).json({
      error: "Missing required query parameter: projectId",
      hint: "Call GET /api/powerbi/projects to list available project IDs, then pass one as ?projectId=<id>.",
    });
    return null;
  }
  return projectId;
}

function optionalProjectId(req: Request): string | undefined {
  return typeof req.query.projectId === "string" ? req.query.projectId : undefined;
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

  // ==========================================================================
  // Legacy / ops-level feeds (global — span every tracked host, every project)
  // ==========================================================================

  /**
   * 1. High-Level Executive KPI Summary (PowerBI Cards & Dashboards)
   * GET /api/powerbi/summary?window=24h&projectId=&format=json|csv
   */
  r.get(["/api/powerbi/summary", "/powerbi/summary"], async (req, res) => {
    try {
      const windowId = windowSchema.parse(req.query.window);
      const interval = WINDOWS_SQL[windowId] ?? "24 hours";
      const projectId = optionalProjectId(req);

      const summaryParams: unknown[] = [interval];
      let projectClause = "";
      if (projectId) {
        summaryParams.push(projectId);
        projectClause = ` AND project_id = $${summaryParams.length}`;
      }

      const summarySql = `
        SELECT
          COUNT(*)::int AS total_requests,
          COUNT(CASE WHEN outcome = 'SUCCESS' THEN 1 END)::int AS success_count,
          COUNT(CASE WHEN outcome = 'FAILURE' THEN 1 END)::int AS failure_count,
          COUNT(CASE WHEN outcome = 'OTHER' THEN 1 END)::int AS other_count,
          COUNT(DISTINCT COALESCE(user_id, user_email))::int AS unique_users,
          COUNT(DISTINCT session_id)::int AS unique_sessions
        FROM api_events
        WHERE occurred_at >= now() - $1::interval${projectClause}
      `;
      const sRes = await pool.query(summarySql, summaryParams);
      const s = sRes.rows[0] ?? {};

      const total = s.total_requests ?? 0;
      const success = s.success_count ?? 0;
      const failure = s.failure_count ?? 0;
      const other = s.other_count ?? 0;
      const successRatePct = total > 0 ? Number(((success / total) * 100).toFixed(2)) : 100;
      const errorRatePct = total > 0 ? Number(((failure / total) * 100).toFixed(2)) : 0;

      // Incidents are a global/ops-level concept (no project linkage) — only meaningful unfiltered.
      let openIncidents = 0;
      if (!projectId) {
        const incRes = await pool.query(`SELECT COUNT(*)::int AS open_incidents FROM incidents WHERE status != 'resolved'`);
        openIncidents = incRes.rows[0]?.open_incidents ?? 0;
      }

      const failedSessSql = `
        SELECT COUNT(*)::int AS failed_sessions
        FROM user_sessions
        WHERE ended_at >= now() - $1::interval AND failure_events > 0${projectClause}
      `;
      const fSessRes = await pool.query(failedSessSql, summaryParams);
      const failedSessions = fSessRes.rows[0]?.failed_sessions ?? 0;

      const result = {
        window: windowId,
        projectId: projectId ?? null,
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
   * GET /api/powerbi/events?startDate=...&endDate=...&service=&outcome=&projectId=&ingestSource=direct|sentry|sdk&limit=1000&offset=0&format=json|csv
   */
  r.get(["/api/powerbi/events", "/powerbi/events"], async (req, res) => {
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 500), 5000);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (req.query.service) {
        conditions.push(`ae.service = $${idx++}`);
        params.push(String(req.query.service).toUpperCase());
      }
      if (req.query.outcome) {
        conditions.push(`ae.outcome = $${idx++}`);
        params.push(String(req.query.outcome).toUpperCase());
      }
      if (req.query.projectId) {
        conditions.push(`ae.project_id = $${idx++}`);
        params.push(String(req.query.projectId));
      }
      if (req.query.ingestSource) {
        conditions.push(`ae.ingest_source = $${idx++}`);
        params.push(String(req.query.ingestSource));
      }
      if (req.query.startDate) {
        conditions.push(`ae.occurred_at >= $${idx++}`);
        params.push(new Date(String(req.query.startDate)).toISOString());
      }
      if (req.query.endDate) {
        conditions.push(`ae.occurred_at <= $${idx++}`);
        params.push(new Date(String(req.query.endDate)).toISOString());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const querySql = `
        SELECT
          ae.id::text,
          ae.occurred_at AS "occurredAt",
          ae.service,
          ae.app_service AS "appService",
          ae.endpoint,
          ae.request_url AS "requestUrl",
          ae.http_method AS "httpMethod",
          ae.status_code AS "statusCode",
          ae.latency_ms AS "latencyMs",
          ae.outcome,
          ae.source,
          ae.ingest_source AS "ingestSource",
          ae.session_id AS "sessionId",
          ae.user_id AS "userId",
          ae.user_email AS "userEmail",
          ae.user_role AS "userRole",
          ae.account_type AS "accountType",
          ae.failure_reason AS "failureReason",
          ae.upstream_key AS "upstreamKey",
          ae.current_screen AS "currentScreen",
          ae.project_id::text AS "projectId",
          p.name AS "projectName"
        FROM api_events ae
        LEFT JOIN projects p ON p.id = ae.project_id
        ${whereClause}
        ORDER BY ae.occurred_at DESC
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
   * GET /api/powerbi/sessions?hasFailures=true&projectId=&limit=500&format=json|csv
   */
  r.get(["/api/powerbi/sessions", "/powerbi/sessions"], async (req, res) => {
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 500), 5000);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (req.query.hasFailures === "true") {
        conditions.push(`us.failure_events > 0`);
      }
      if (req.query.userEmail) {
        conditions.push(`us.user_email ILIKE $${idx++}`);
        params.push(`%${req.query.userEmail}%`);
      }
      if (req.query.projectId) {
        conditions.push(`us.project_id = $${idx++}`);
        params.push(String(req.query.projectId));
      }
      if (req.query.startDate) {
        conditions.push(`us.started_at >= $${idx++}`);
        params.push(new Date(String(req.query.startDate)).toISOString());
      }
      if (req.query.endDate) {
        conditions.push(`us.ended_at <= $${idx++}`);
        params.push(new Date(String(req.query.endDate)).toISOString());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const querySql = `
        SELECT
          us.session_id AS "sessionId",
          us.user_id AS "userId",
          us.user_email AS "userEmail",
          us.role,
          us.account_type AS "accountType",
          us.started_at AS "startedAt",
          us.ended_at AS "endedAt",
          us.total_events AS "totalEvents",
          us.failure_events AS "failureEvents",
          us.distinct_endpoints AS "distinctEndpoints",
          us.platform,
          us.os,
          us.app_version AS "appVersion",
          us.network,
          us.project_id::text AS "projectId",
          p.name AS "projectName"
        FROM user_sessions us
        LEFT JOIN projects p ON p.id = us.project_id
        ${whereClause}
        ORDER BY us.ended_at DESC
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
          platform: row.platform,
          os: row.os,
          appVersion: row.appVersion,
          network: row.network,
          projectId: row.projectId,
          projectName: row.projectName,
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
   * GET /api/powerbi/upstream-health?window=24h&projectId=&format=json|csv
   */
  r.get(["/api/powerbi/upstream-health", "/powerbi/upstream-health"], async (req, res) => {
    try {
      const windowId = windowSchema.parse(req.query.window);
      const interval = WINDOWS_SQL[windowId] ?? "24 hours";
      const projectId = optionalProjectId(req);

      const params: unknown[] = [interval];
      let projectClause = "";
      if (projectId) {
        params.push(projectId);
        projectClause = ` AND project_id = $${params.length}`;
      }

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
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms)::int AS "p99Ms",
          MAX(occurred_at) AS "lastSeen"
        FROM api_events
        WHERE occurred_at >= now() - $1::interval${projectClause}
        GROUP BY COALESCE(upstream_key, 'unknown'), service
        ORDER BY "totalRequests" DESC
      `;

      const result = await pool.query(querySql, params);

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
          p99Ms: row.p99Ms ?? 0,
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
   * Global/ops-level only — the `incidents` table has no project linkage.
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

  // ==========================================================================
  // Monitor tenancy — organizations & projects dimension table
  // ==========================================================================

  /**
   * 6. Projects Dimension Table (PowerBI Slicer / join key for every endpoint below)
   * GET /api/powerbi/projects?format=json|csv
   */
  r.get(["/api/powerbi/projects", "/powerbi/projects"], async (req, res) => {
    try {
      const querySql = `
        SELECT
          p.id::text AS "projectId",
          p.name AS "projectName",
          p.slug AS "projectSlug",
          p.platform,
          p.retention_days AS "retentionDays",
          cardinality(p.allowed_hosts)::int AS "allowedHostCount",
          p.created_at AS "createdAt",
          o.id::text AS "organizationId",
          o.name AS "organizationName",
          o.slug AS "organizationSlug",
          (o.suspended_at IS NOT NULL) AS "organizationSuspended"
        FROM projects p
        JOIN organizations o ON o.id = p.organization_id
        ORDER BY o.name, p.name
      `;
      const result = await pool.query(querySql);
      const formatted = result.rows.map((row) => ({
        ...row,
        createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      }));
      respond(res, formatted, req.query.format as string, "powerbi_projects");
    } catch (err) {
      console.error("[powerbi] Projects dimension error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI projects dimension table" });
    }
  });

  // ==========================================================================
  // Monitor SDK journey/behavior feed — screens, clicks, forms, search, filter,
  // modals, downloads, uploads, purchases, logout: every UI event kind captured
  // by the monitor-web / monitor-react-native SDKs, in addition to raw api_events.
  // ==========================================================================

  /**
   * 7. Journey & Behavior Events Feed (PowerBI Fact Table — UI/behavior telemetry)
   * GET /api/powerbi/journey-events?projectId=&kind=&sessionId=&startDate=&endDate=&limit=1000&offset=0&format=json|csv
   * `kind` is one of: navigation, lifecycle, auth, click, screen_view, form_start,
   * form_submit, search, filter, modal_open, modal_close, download, file_upload,
   * purchase_start, purchase_complete, logout.
   */
  r.get(["/api/powerbi/journey-events", "/powerbi/journey-events"], async (req, res) => {
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 500), 5000);
      const offset = Math.max(0, Number(req.query.offset) || 0);

      const conditions: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (req.query.projectId) {
        conditions.push(`sa.project_id = $${idx++}`);
        params.push(String(req.query.projectId));
      }
      if (req.query.kind) {
        conditions.push(`sa.kind = $${idx++}`);
        params.push(String(req.query.kind));
      }
      if (req.query.sessionId) {
        conditions.push(`sa.session_id = $${idx++}`);
        params.push(String(req.query.sessionId));
      }
      if (req.query.startDate) {
        conditions.push(`sa.occurred_at >= $${idx++}`);
        params.push(new Date(String(req.query.startDate)).toISOString());
      }
      if (req.query.endDate) {
        conditions.push(`sa.occurred_at <= $${idx++}`);
        params.push(new Date(String(req.query.endDate)).toISOString());
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      const querySql = `
        SELECT
          sa.id::text,
          sa.project_id::text AS "projectId",
          p.name AS "projectName",
          sa.session_id AS "sessionId",
          sa.occurred_at AS "occurredAt",
          sa.kind,
          sa.message,
          sa.screen,
          sa.from_screen AS "fromScreen",
          sa.payload,
          us.user_id AS "userId",
          us.user_email AS "userEmail",
          us.role AS "userRole"
        FROM session_actions sa
        LEFT JOIN projects p ON p.id = sa.project_id
        LEFT JOIN user_sessions us ON us.session_id = sa.session_id
        ${whereClause}
        ORDER BY sa.occurred_at DESC
        LIMIT $${idx++} OFFSET $${idx++}
      `;

      const result = await pool.query(querySql, [...params, limit, offset]);
      const formatted = result.rows.map((row) => ({
        ...row,
        occurredAt: row.occurredAt ? new Date(row.occurredAt).toISOString() : null,
      }));

      respond(res, formatted, req.query.format as string, "powerbi_journey_events");
    } catch (err) {
      console.error("[powerbi] Journey events feed error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI journey events feed" });
    }
  });

  // ==========================================================================
  // Monitor analytics — reuses the same service functions behind the org
  // console (backend/src/services/monitorInsights.ts, monitorReports.ts), so
  // these numbers always match what a partner sees in their own dashboard.
  // All require ?projectId=; date range via ?from=&to= or ?days= (default 7).
  // ==========================================================================

  /**
   * 8. Daily Metrics Rollup (PowerBI time-series fact table — one row per day)
   * GET /api/powerbi/daily-metrics?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/daily-metrics", "/powerbi/daily-metrics"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const overview = await getReportOverview(pool, projectId, range);
      const rows = overview.daily.map((d) => ({ projectId, ...d }));
      respond(res, rows, req.query.format as string, "powerbi_daily_metrics");
    } catch (err) {
      console.error("[powerbi] Daily metrics error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI daily metrics" });
    }
  });

  /**
   * 9. Problems Fact Table — one row per failing endpoint/status group
   * GET /api/powerbi/problems?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/problems", "/powerbi/problems"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getProjectProblems(pool, projectId, range);
      const rows = data.errors.map((e) => ({
        projectId,
        method: e.method,
        path: e.path,
        statusCode: e.statusCode,
        failureReason: e.failureReason,
        occurrences: e.occurrences,
        usersAffected: e.usersAffected,
        sessionsAffected: e.sessionsAffected,
        firstSeen: e.firstSeen,
        lastSeen: e.lastSeen,
        avgLatencyMs: e.avgLatencyMs,
        errorRatePct: Number((e.errorRate * 100).toFixed(2)),
        severity: e.severity,
        impactScore: e.impact.score,
        impactLabel: e.impact.label,
      }));
      respond(res, rows, req.query.format as string, "powerbi_problems");
    } catch (err) {
      console.error("[powerbi] Problems error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI problems feed" });
    }
  });

  /**
   * 10. Problems Summary — single-row KPI card feed (totals, priority breakdown, deltas)
   * GET /api/powerbi/problems-summary?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/problems-summary", "/powerbi/problems-summary"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getProjectProblems(pool, projectId, range);
      const result = {
        projectId,
        totalErrors: data.summary.totalErrors,
        totalErrorsDeltaPct: data.summary.totalErrorsDelta,
        usersAffected: data.summary.usersAffected,
        usersAffectedDeltaPct: data.summary.usersAffectedDelta,
        errors5xx: data.summary.errors5xx,
        errors5xxDeltaPct: data.summary.errors5xxDelta,
        usersInRange: data.summary.usersInRange,
        priorityCritical: data.priority.critical,
        priorityHigh: data.priority.high,
        priorityMedium: data.priority.medium,
        priorityLow: data.priority.low,
      };
      respond(res, result, req.query.format as string, "powerbi_problems_summary");
    } catch (err) {
      console.error("[powerbi] Problems summary error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI problems summary" });
    }
  });

  /**
   * 11. Performance Fact Table — one row per endpoint (avg/P95/P99/max latency)
   * GET /api/powerbi/performance?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/performance", "/powerbi/performance"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getProjectPerformance(pool, projectId, range);
      const rows = data.endpoints.map((e) => ({ projectId, ...e }));
      respond(res, rows, req.query.format as string, "powerbi_performance");
    } catch (err) {
      console.error("[powerbi] Performance error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI performance feed" });
    }
  });

  /**
   * 12. Performance Summary — single-row KPI card feed + hourly/daily latency series
   * GET /api/powerbi/performance-summary?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/performance-summary", "/powerbi/performance-summary"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getProjectPerformance(pool, projectId, range);
      const result = {
        projectId,
        avgLatencyMs: data.kpis.avgLatencyMs,
        avgLatencyDeltaPct: data.kpis.avgDelta,
        p95Ms: data.kpis.p95Ms,
        p95DeltaPct: data.kpis.p95Delta,
        p99Ms: data.kpis.p99Ms,
        p99DeltaPct: data.kpis.p99Delta,
        slowApis: data.kpis.slowApis,
        slowApisDeltaPct: data.kpis.slowDelta,
        latencySeries: data.latency,
        latencySeriesUnit: data.latencyUnit,
      };
      respond(res, result, req.query.format as string, "powerbi_performance_summary");
    } catch (err) {
      console.error("[powerbi] Performance summary error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI performance summary" });
    }
  });

  /**
   * 13. Funnel Steps Fact Table — one row per screen in the sequential screen funnel
   * GET /api/powerbi/funnels?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/funnels", "/powerbi/funnels"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getFunnelReport(pool, projectId, range);
      const rows = data.steps.map((s, i) => ({
        projectId,
        stepIndex: i + 1,
        screen: s.screen,
        users: s.users,
        conversionPct: Number((s.conversion * 100).toFixed(2)),
      }));
      respond(res, rows, req.query.format as string, "powerbi_funnels");
    } catch (err) {
      console.error("[powerbi] Funnels error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI funnel feed" });
    }
  });

  /**
   * 14. Funnel Transitions Fact Table — one row per observed screen-to-screen transition
   * GET /api/powerbi/funnel-transitions?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/funnel-transitions", "/powerbi/funnel-transitions"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getFunnelReport(pool, projectId, range);
      const rows = data.transitions.map((t) => ({ projectId, from: t.from, to: t.to, count: t.count }));
      respond(res, rows, req.query.format as string, "powerbi_funnel_transitions");
    } catch (err) {
      console.error("[powerbi] Funnel transitions error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI funnel transitions feed" });
    }
  });

  /**
   * 15. Funnel Summary — overall conversion rate + largest drop-off
   * GET /api/powerbi/funnel-summary?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/funnel-summary", "/powerbi/funnel-summary"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getFunnelReport(pool, projectId, range);
      const result = {
        projectId,
        overallConversionPct: Number((data.conversion * 100).toFixed(2)),
        dropoffFrom: data.dropoff?.from ?? null,
        dropoffTo: data.dropoff?.to ?? null,
        dropoffFromCount: data.dropoff?.fromCount ?? null,
        dropoffToCount: data.dropoff?.toCount ?? null,
        dropoffRatePct: data.dropoff ? Number((data.dropoff.rate * 100).toFixed(2)) : null,
        dropoffCauses: data.dropoff?.causes?.join(", ") ?? null,
      };
      respond(res, result, req.query.format as string, "powerbi_funnel_summary");
    } catch (err) {
      console.error("[powerbi] Funnel summary error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI funnel summary" });
    }
  });

  /**
   * 16. Retention Cohort Table — one row per day (D1/D7 return rates)
   * GET /api/powerbi/retention?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/retention", "/powerbi/retention"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getReportRetention(pool, projectId, range);
      const rows = data.days.map((d) => ({
        projectId,
        date: d.date,
        users: d.users,
        returned1d: d.returned1d,
        rate1dPct: Number((d.rate1d * 100).toFixed(2)),
        returned7d: d.returned7d,
        rate7dPct: Number((d.rate7d * 100).toFixed(2)),
      }));
      respond(res, rows, req.query.format as string, "powerbi_retention");
    } catch (err) {
      console.error("[powerbi] Retention error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI retention feed" });
    }
  });

  /**
   * 17. Most Visited Screens Fact Table
   * GET /api/powerbi/behavior-screens?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/behavior-screens", "/powerbi/behavior-screens"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getReportBehavior(pool, projectId, range);
      const rows = data.screens.map((s) => ({ projectId, ...s }));
      respond(res, rows, req.query.format as string, "powerbi_behavior_screens");
    } catch (err) {
      console.error("[powerbi] Behavior screens error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI behavior screens feed" });
    }
  });

  /**
   * 18. Most Common Journeys Fact Table
   * GET /api/powerbi/behavior-journeys?projectId=&from=&to=&days=&format=json|csv
   */
  r.get(["/api/powerbi/behavior-journeys", "/powerbi/behavior-journeys"], async (req, res) => {
    try {
      const projectId = requireProjectId(req, res);
      if (!projectId) return;
      const range = reportQueryRange(req.query);
      const data = await getReportBehavior(pool, projectId, range);
      const rows = data.journeys.map((j) => ({
        projectId,
        path: j.path.join(" -> "),
        stepCount: j.path.length,
        sessions: j.count,
        sharePct: Number((j.pct * 100).toFixed(2)),
      }));
      respond(res, rows, req.query.format as string, "powerbi_behavior_journeys");
    } catch (err) {
      console.error("[powerbi] Behavior journeys error", err);
      res.status(500).json({ error: "Failed to fetch PowerBI behavior journeys feed" });
    }
  });

  return r;
}
