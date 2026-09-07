import { Router, type IRouter } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { config } from "../config.js";
import { requireConsoleJwt } from "../middleware/consoleJwt.js";
import { requireOrg, requireProject } from "../middleware/consoleAuth.js";
import { generateApiKey } from "../services/apiKeys.js";
import { slugify, canViewKeys } from "../services/orgRoles.js";
import {
  listProjectUpstreams,
  refreshAllowedHosts,
} from "../services/tenancy.js";
import { getProjectOverview, getProjectApiStats } from "../services/monitorMetrics.js";
import { deviceOrigins } from "../services/lanHost.js";
import {
  getProjectSessionActions,
  getProjectSessionFailures,
  listProjectSessions,
} from "../services/monitorSessions.js";
import {
  getJourneyHome,
  getUserDays,
  getUserProfile,
  getUserSessionsInRange,
  getUserTimeline,
  listProjectUsers,
  parseDateRange,
} from "../services/monitorJourney.js";
import {
  getFunnelReport,
  getProblemAffectedUsers,
  getProblemDetail,
  getProjectDashboard,
  getProjectPerformance,
  getProjectProblems,
  getReportBehavior,
  parseProblemKey,
} from "../services/monitorInsights.js";
import {
  exportReportCsv,
  getReportOverview,
  getReportRetention,
  reportQueryRange,
} from "../services/monitorReports.js";
import { exportReportPdf } from "../services/monitorReportPdf.js";
import { exportExecutiveReportPdf } from "../services/monitorExecutiveReportPdf.js";

const createProjectSchema = z.object({
  name: z.string().min(1).max(80),
  platform: z.enum(["react-native", "web"]),
});

const createKeySchema = z.object({
  name: z.string().min(1).max(64).default("default"),
});

const upstreamSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .transform((s) => s.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_")),
  host: z.string().min(1).max(255).transform((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")),
  label: z.string().max(120).optional(),
});

const retentionSchema = z.object({
  retentionDays: z.number().int().min(1).max(365),
});

export function consoleProjectsRouter(pool: Pool): IRouter {
  const r = Router();
  r.use("/console", requireConsoleJwt);

  r.get(
    "/console/organizations/:orgId/projects",
    requireOrg(pool, "viewer"),
    async (req, res) => {
      const q = await pool.query(
        `SELECT id::text, name, slug, platform, created_at,
                cardinality(allowed_hosts) AS host_count
         FROM projects WHERE organization_id = $1 ORDER BY name ASC`,
        [req.params.orgId]
      );
      res.json(
        q.rows.map((row) => ({
          id: row.id,
          name: row.name,
          slug: row.slug,
          platform: row.platform,
          createdAt: row.created_at,
          hostCount: row.host_count,
        }))
      );
    }
  );

  r.post(
    "/console/organizations/:orgId/projects",
    requireOrg(pool, "admin"),
    async (req, res) => {
      const parsed = createProjectSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      let slug = slugify(parsed.data.name);
      const clash = await pool.query(
        `SELECT 1 FROM projects WHERE organization_id = $1 AND slug = $2`,
        [req.params.orgId, slug]
      );
      if (clash.rows.length) slug = `${slug}-${Date.now().toString(36)}`;
      const q = await pool.query<{ id: string }>(
        `INSERT INTO projects (organization_id, name, slug, platform)
         VALUES ($1, $2, $3, $4) RETURNING id::text`,
        [req.params.orgId, parsed.data.name.trim(), slug, parsed.data.platform]
      );
      res.status(201).json({
        id: q.rows[0]!.id,
        name: parsed.data.name.trim(),
        slug,
        platform: parsed.data.platform,
      });
    }
  );

  r.get(
    "/console/projects/:projectId",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const p = req.consoleProject!;
      const upstreams = await listProjectUpstreams(pool, p.id);
      res.json({
        ...p,
        upstreams,
        role: req.consoleMembership!.role,
      });
    }
  );

  r.patch(
    "/console/projects/:projectId",
    requireProject(pool, "admin"),
    async (req, res) => {
      const parsed = retentionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await pool.query(`UPDATE projects SET retention_days = $2 WHERE id = $1`, [
        req.params.projectId,
        parsed.data.retentionDays,
      ]);
      res.json({ ok: true, retentionDays: parsed.data.retentionDays });
    }
  );

  r.get(
    "/console/projects/:projectId/keys",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const role = req.consoleMembership!.role;
      if (!canViewKeys(role) && !req.consoleAuth!.isPlatformAdmin) {
        res.status(403).json({ error: "Admins can view API keys" });
        return;
      }
      const q = await pool.query(
        `SELECT id::text, name, key_prefix, created_at, revoked_at, last_used_at
         FROM project_api_keys WHERE project_id = $1 ORDER BY created_at DESC`,
        [req.params.projectId]
      );
      res.json(
        q.rows.map((row) => ({
          id: row.id,
          name: row.name,
          prefix: row.key_prefix,
          createdAt: row.created_at,
          revokedAt: row.revoked_at,
          lastUsedAt: row.last_used_at,
        }))
      );
    }
  );

  r.post(
    "/console/projects/:projectId/keys",
    requireProject(pool, "admin"),
    async (req, res) => {
      const parsed = createKeySchema.safeParse(req.body ?? {});
      const name = parsed.success ? parsed.data.name : "default";
      const generated = generateApiKey();
      const q = await pool.query<{ id: string }>(
        `INSERT INTO project_api_keys (project_id, name, key_prefix, key_hash)
         VALUES ($1, $2, $3, $4) RETURNING id::text`,
        [req.params.projectId, name, generated.prefix, generated.hash]
      );
      res.status(201).json({
        id: q.rows[0]!.id,
        name,
        prefix: generated.prefix,
        key: generated.raw,
        warning: "Store this key now. It will not be shown again.",
      });
    }
  );

  r.post(
    "/console/projects/:projectId/keys/:keyId/revoke",
    requireProject(pool, "admin"),
    async (req, res) => {
      await pool.query(
        `UPDATE project_api_keys SET revoked_at = now()
         WHERE id = $1 AND project_id = $2 AND revoked_at IS NULL`,
        [req.params.keyId, req.params.projectId]
      );
      res.json({ ok: true });
    }
  );

  r.get(
    "/console/projects/:projectId/upstreams",
    requireProject(pool, "viewer"),
    async (req, res) => {
      res.json(await listProjectUpstreams(pool, req.params.projectId!));
    }
  );

  r.post(
    "/console/projects/:projectId/upstreams",
    requireProject(pool, "admin"),
    async (req, res) => {
      const parsed = upstreamSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const q = await pool.query<{ id: string }>(
          `INSERT INTO project_upstreams (project_id, slug, host, label)
           VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [
            req.params.projectId,
            parsed.data.slug,
            parsed.data.host,
            parsed.data.label ?? parsed.data.slug,
          ]
        );
        await refreshAllowedHosts(pool, req.params.projectId!);
        res.status(201).json({ id: q.rows[0]!.id, ...parsed.data });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "23505") {
          res.status(409).json({ error: "Slug or host already exists on this project" });
          return;
        }
        throw err;
      }
    }
  );

  r.delete(
    "/console/projects/:projectId/upstreams/:upstreamId",
    requireProject(pool, "admin"),
    async (req, res) => {
      await pool.query(
        `DELETE FROM project_upstreams WHERE id = $1 AND project_id = $2`,
        [req.params.upstreamId, req.params.projectId]
      );
      await refreshAllowedHosts(pool, req.params.projectId!);
      res.status(204).end();
    }
  );

  r.get(
    "/console/projects/:projectId/overview",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const days = Number(req.query.days) || 7;
      res.json(await getProjectOverview(pool, req.params.projectId!, days));
    }
  );

  r.get(
    "/console/projects/:projectId/apis",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const days = Number(req.query.days) || 7;
      const stats = await getProjectApiStats(pool, req.params.projectId!, days);
      const upstreams = await listProjectUpstreams(pool, req.params.projectId!);
      res.json({ upstreams, stats });
    }
  );

  r.get(
    "/console/projects/:projectId/sessions",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      const items = await listProjectSessions(pool, req.params.projectId!, {
        email: typeof req.query.email === "string" ? req.query.email : undefined,
        sessionId:
          typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
        failuresOnly: req.query.failures === "1",
        from: range.from,
        to: range.to,
      });
      res.json(items);
    }
  );

  r.get(
    "/console/projects/:projectId/sessions/:sessionId",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const data = await getProjectSessionActions(
        pool,
        req.params.projectId!,
        req.params.sessionId!
      );
      if (!data) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(data);
    }
  );

  r.get(
    "/console/projects/:projectId/journey",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = parseDateRange({
        date: typeof req.query.date === "string" ? req.query.date : undefined,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        days: req.query.days != null ? Number(req.query.days) : undefined,
      });
      res.json(await getJourneyHome(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/users",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = parseDateRange({
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        days: req.query.days != null ? Number(req.query.days) : 30,
      });
      const items = await listProjectUsers(pool, req.params.projectId!, {
        search: typeof req.query.search === "string" ? req.query.search : undefined,
        filter: typeof req.query.filter === "string" ? req.query.filter : undefined,
        range,
      });
      res.json(items);
    }
  );

  r.get(
    "/console/projects/:projectId/users/:userKey/days",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = parseDateRange({
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        days: req.query.days != null ? Number(req.query.days) : 31,
      });
      const days = await getUserDays(
        pool,
        req.params.projectId!,
        req.params.userKey!,
        range
      );
      const sessions = await getUserSessionsInRange(
        pool,
        req.params.projectId!,
        req.params.userKey!,
        range
      );
      res.json({ days, sessions });
    }
  );

  r.get(
    "/console/projects/:projectId/users/:userKey/timeline",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = parseDateRange({
        date: typeof req.query.date === "string" ? req.query.date : undefined,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        days: req.query.days != null ? Number(req.query.days) : 7,
      });
      const data = await getUserTimeline(
        pool,
        req.params.projectId!,
        req.params.userKey!,
        range,
        {
          kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
          status: typeof req.query.status === "string" ? req.query.status : undefined,
          method: typeof req.query.method === "string" ? req.query.method : undefined,
          screen: typeof req.query.screen === "string" ? req.query.screen : undefined,
          sessionId:
            typeof req.query.sessionId === "string" ? req.query.sessionId : undefined,
          statusClass:
            typeof req.query.statusClass === "string" ? req.query.statusClass : undefined,
          minLatency:
            req.query.minLatency != null ? Number(req.query.minLatency) : undefined,
        }
      );
      res.json(data);
    }
  );

  r.get(
    "/console/projects/:projectId/users/:userKey",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const profile = await getUserProfile(
        pool,
        req.params.projectId!,
        req.params.userKey!
      );
      if (!profile) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json(profile);
    }
  );

  r.get(
    "/console/projects/:projectId/problems",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      res.json(await getProjectProblems(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/problems/:problemKey/users",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      const key = parseProblemKey(req.params.problemKey!);
      res.json(
        await getProblemAffectedUsers(pool, req.params.projectId!, range, key, {
          search: typeof req.query.search === "string" ? req.query.search : undefined,
        })
      );
    }
  );

  r.get(
    "/console/projects/:projectId/problems/:problemKey",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      const key = parseProblemKey(req.params.problemKey!);
      const data = await getProblemDetail(pool, req.params.projectId!, range, key);
      if (!data.occurrences) {
        res.status(404).json({ error: "Problem not found" });
        return;
      }
      res.json(data);
    }
  );

  r.get(
    "/console/projects/:projectId/dashboard",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      res.json(await getProjectDashboard(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/performance",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      res.json(await getProjectPerformance(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/behavior",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      res.json(await getReportBehavior(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/reports/overview",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      res.json(await getReportOverview(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/reports/funnels",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      res.json(await getFunnelReport(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/reports/retention",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      res.json(await getReportRetention(pool, req.params.projectId!, range));
    }
  );

  r.get(
    "/console/projects/:projectId/reports/export",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      const dataset = typeof req.query.dataset === "string" ? req.query.dataset : "daily";
      try {
        const { filename, csv } = await exportReportCsv(
          pool,
          req.params.projectId!,
          range,
          dataset
        );
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(csv);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Export failed" });
      }
    }
  );

  r.get(
    "/console/projects/:projectId/reports/pdf",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      const sectionsParam = typeof req.query.sections === "string" ? req.query.sections : "";
      const sections = new Set(
        sectionsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      );
      try {
        const { filename, buffer } = await exportReportPdf(
          pool,
          req.params.projectId!,
          req.consoleProject!.name,
          range,
          sections.size > 0 ? sections : undefined
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(buffer.length));
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.end(buffer);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "PDF export failed" });
      }
    }
  );

  r.get(
    "/console/projects/:projectId/reports/executive-pdf",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const range = reportQueryRange(req.query);
      try {
        const { filename, buffer } = await exportExecutiveReportPdf(
          pool,
          req.params.projectId!,
          req.consoleProject!.name,
          range
        );
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(buffer.length));
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.end(buffer);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "Executive report export failed" });
      }
    }
  );

  r.get(
    "/console/projects/:projectId/sessions/:sessionId/failures",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const data = await getProjectSessionFailures(
        pool,
        req.params.projectId!,
        req.params.sessionId!
      );
      if (!data) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(data);
    }
  );

  r.get(
    "/console/projects/:projectId/integration",
    requireProject(pool, "viewer"),
    async (req, res) => {
      const p = req.consoleProject!;
      const ingestUrl = `${config.publicIngestUrl}/ingest/v1`;
      const { lanOrigin, androidEmulatorOrigin } = deviceOrigins(
        config.publicIngestUrl,
        config.port
      );
      const deviceOrigin = lanOrigin ?? config.publicIngestUrl;
      res.json({
        ingestUrl,
        configUrl: `${ingestUrl}/config`,
        deviceIngestUrl: `${deviceOrigin}/ingest/v1`,
        androidEmulatorIngestUrl: `${androidEmulatorOrigin}/ingest/v1`,
        platform: p.platform,
        allowedHosts: p.allowedHosts,
        packages: {
          web: "@koralink/monitor-web",
          reactNative: "@koralink/monitor-react-native",
        },
      });
    }
  );

  return r;
}
