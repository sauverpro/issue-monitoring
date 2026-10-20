import type { IRouter } from "express";
import { asyncRouter } from "./asyncRouter.js";
import type { Pool } from "pg";
import { requireConsoleJwt } from "../middleware/consoleJwt.js";
import { requireProject } from "../middleware/consoleAuth.js";
import { reportQueryRange } from "../services/monitorReports.js";
import {
  FUNNEL_TEMPLATES,
  evaluateFunnel,
  evaluateProjectFunnels,
  funnelDefSchema,
} from "../services/featureFunnels.js";
import {
  createFeedback,
  createRelease,
  feedbackCreateSchema,
  feedbackUpdateSchema,
  getFeedback,
  getFeedbackSummary,
  listFeedback,
  listReleases,
  releaseCreateSchema,
  releaseUpdateSchema,
  updateFeedback,
  updateRelease,
} from "../services/productOps.js";
import {
  deleteSchedule,
  deliverScheduledReport,
  listSchedules,
  scheduleUpsertSchema,
  upsertSchedule,
} from "../services/reportSchedules.js";
import { emailConfigured } from "../services/notifications/email.js";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === "23505";
}

/** Feedback backlog, release calendar, feature funnels and report schedules (workplan 9.2.1). */
export function consoleProductOpsRouter(pool: Pool): IRouter {
  const r = asyncRouter();
  r.use("/console", requireConsoleJwt);
  const base = "/console/projects/:projectId";

  // -- Feedback ----------------------------------------------------------

  r.get(`${base}/feedback`, requireProject(pool, "viewer"), async (req, res) => {
    res.json(
      await listFeedback(pool, req.params.projectId!, {
        status: str(req.query.status),
        feature: str(req.query.feature),
        source: str(req.query.source),
        category: str(req.query.category),
        search: str(req.query.search),
      })
    );
  });

  r.get(`${base}/feedback/summary`, requireProject(pool, "viewer"), async (req, res) => {
    res.json(await getFeedbackSummary(pool, req.params.projectId!, reportQueryRange(req.query)));
  });

  r.post(`${base}/feedback`, requireProject(pool, "member"), async (req, res) => {
    const parsed = feedbackCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const id = await createFeedback(pool, req.params.projectId!, parsed.data, req.consoleAuth!.sub);
    res.status(201).json(await getFeedback(pool, req.params.projectId!, id));
  });

  r.patch(`${base}/feedback/:feedbackId`, requireProject(pool, "member"), async (req, res) => {
    const parsed = feedbackUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const ok = await updateFeedback(pool, req.params.projectId!, req.params.feedbackId!, parsed.data);
      if (!ok) {
        res.status(404).json({ error: "Feedback not found" });
        return;
      }
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Update failed" });
      return;
    }
    res.json(await getFeedback(pool, req.params.projectId!, req.params.feedbackId!));
  });

  r.delete(`${base}/feedback/:feedbackId`, requireProject(pool, "admin"), async (req, res) => {
    await pool.query(`DELETE FROM project_feedback WHERE id = $1 AND project_id = $2`, [
      req.params.feedbackId,
      req.params.projectId,
    ]);
    res.status(204).end();
  });

  // -- Releases ------------------------------------------------------------

  r.get(`${base}/releases`, requireProject(pool, "viewer"), async (req, res) => {
    res.json(await listReleases(pool, req.params.projectId!));
  });

  r.post(`${base}/releases`, requireProject(pool, "admin"), async (req, res) => {
    const parsed = releaseCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const id = await createRelease(pool, req.params.projectId!, parsed.data, req.consoleAuth!.sub);
      res.status(201).json({ id });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: `Version ${parsed.data.version} already exists` });
        return;
      }
      throw err;
    }
  });

  r.patch(`${base}/releases/:releaseId`, requireProject(pool, "admin"), async (req, res) => {
    const parsed = releaseUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const ok = await updateRelease(pool, req.params.projectId!, req.params.releaseId!, parsed.data);
      if (!ok) {
        res.status(404).json({ error: "Release not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      if (isUniqueViolation(err)) {
        res.status(409).json({ error: "That version already exists" });
        return;
      }
      throw err;
    }
  });

  r.delete(`${base}/releases/:releaseId`, requireProject(pool, "admin"), async (req, res) => {
    await pool.query(`DELETE FROM project_releases WHERE id = $1 AND project_id = $2`, [
      req.params.releaseId,
      req.params.projectId,
    ]);
    res.status(204).end();
  });

  // -- Feature funnels -----------------------------------------------------

  r.get(`${base}/feature-funnels/templates`, requireProject(pool, "viewer"), (_req, res) => {
    res.json(FUNNEL_TEMPLATES);
  });

  r.get(`${base}/feature-funnels`, requireProject(pool, "viewer"), async (req, res) => {
    res.json(await evaluateProjectFunnels(pool, req.params.projectId!, reportQueryRange(req.query)));
  });

  /** Evaluate an unsaved definition (live preview in the funnel editor). */
  r.post(`${base}/feature-funnels/preview`, requireProject(pool, "viewer"), async (req, res) => {
    const parsed = funnelDefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.json(await evaluateFunnel(pool, req.params.projectId!, reportQueryRange(req.query), parsed.data.steps));
  });

  r.post(`${base}/feature-funnels`, requireProject(pool, "admin"), async (req, res) => {
    const parsed = funnelDefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const f = parsed.data;
    const q = await pool.query<{ id: string }>(
      `INSERT INTO project_funnels (project_id, name, feature, description, steps, position, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb,
               (SELECT COALESCE(MAX(position) + 1, 0) FROM project_funnels WHERE project_id = $1), $6)
       RETURNING id::text`,
      [req.params.projectId, f.name, f.feature, f.description, JSON.stringify(f.steps), req.consoleAuth!.sub]
    );
    res.status(201).json({ id: q.rows[0]!.id });
  });

  r.put(`${base}/feature-funnels/:funnelId`, requireProject(pool, "admin"), async (req, res) => {
    const parsed = funnelDefSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const f = parsed.data;
    const q = await pool.query(
      `UPDATE project_funnels SET name = $3, feature = $4, description = $5, steps = $6::jsonb, updated_at = now()
       WHERE id = $1 AND project_id = $2`,
      [req.params.funnelId, req.params.projectId, f.name, f.feature, f.description, JSON.stringify(f.steps)]
    );
    if (!q.rowCount) {
      res.status(404).json({ error: "Funnel not found" });
      return;
    }
    res.json({ ok: true });
  });

  r.delete(`${base}/feature-funnels/:funnelId`, requireProject(pool, "admin"), async (req, res) => {
    await pool.query(`DELETE FROM project_funnels WHERE id = $1 AND project_id = $2`, [
      req.params.funnelId,
      req.params.projectId,
    ]);
    res.status(204).end();
  });

  // -- Scheduled report emails ---------------------------------------------

  r.get(`${base}/report-schedules`, requireProject(pool, "viewer"), async (req, res) => {
    res.json({
      emailConfigured: emailConfigured(),
      schedules: await listSchedules(pool, req.params.projectId!),
    });
  });

  r.put(`${base}/report-schedules`, requireProject(pool, "admin"), async (req, res) => {
    const parsed = scheduleUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    res.json(await upsertSchedule(pool, req.params.projectId!, parsed.data, req.consoleAuth!.sub));
  });

  r.delete(`${base}/report-schedules/:scheduleId`, requireProject(pool, "admin"), async (req, res) => {
    await deleteSchedule(pool, req.params.projectId!, req.params.scheduleId!);
    res.status(204).end();
  });

  /** Send the previous period's report now (also used to test SMTP settings). */
  r.post(`${base}/report-schedules/:scheduleId/send`, requireProject(pool, "admin"), async (req, res) => {
    const q = await pool.query<{ frequency: "weekly" | "monthly" | "quarterly"; recipients: string[] }>(
      `SELECT frequency, recipients FROM report_schedules WHERE id = $1 AND project_id = $2`,
      [req.params.scheduleId, req.params.projectId]
    );
    const s = q.rows[0];
    if (!s) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    try {
      const out = await deliverScheduledReport(pool, {
        projectId: req.params.projectId!,
        projectName: req.consoleProject!.name,
        frequency: s.frequency,
        recipients: s.recipients,
      });
      await pool.query(
        `UPDATE report_schedules SET last_run_at = now(), last_status = $2, last_error = $3 WHERE id = $1`,
        [req.params.scheduleId, out.status, out.status === "sent" ? null : out.detail]
      );
      if (out.status !== "sent") {
        res.status(409).json({ error: out.detail });
        return;
      }
      res.json({ ok: true, detail: out.detail });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      await pool.query(
        `UPDATE report_schedules SET last_run_at = now(), last_status = 'failed', last_error = $2 WHERE id = $1`,
        [req.params.scheduleId, message]
      );
      res.status(502).json({ error: message });
    }
  });

  return r;
}
