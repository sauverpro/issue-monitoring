import type { IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { asyncRouter } from "./asyncRouter.js";
import { requireConsoleJwt } from "../middleware/consoleJwt.js";
import { requireProject } from "../middleware/consoleAuth.js";
import { reportQueryRange } from "../services/monitorReports.js";
import { getIncidentDetail, getIncidentReport, getPaymentsReport, projectServices } from "../services/reliability.js";
import { broadcastSse } from "../sse/hub.js";
import { incidentLink, notifySlack } from "../services/notifications/slack.js";
import { emailIncidentAlert } from "../services/notifications/incidentEmail.js";

const noteSchema = z.object({ body: z.string().trim().min(1).max(4000) });
const statusSchema = z.object({
  status: z.enum(["open", "investigating", "resolved"]),
  resolution: z.string().trim().max(500).optional(),
});
const upstreamPatchSchema = z
  .object({
    category: z.enum(["payments", "core", "digital-services", "other"]),
    channelRole: z.enum(["primary", "backup"]).nullable(),
    label: z.string().trim().min(1).max(120),
  })
  .partial();

/** Incidents, resolution times and payment-channel reliability for a project (workplan 9.1.5). */
export function consoleReliabilityRouter(pool: Pool): IRouter {
  const r = asyncRouter();
  r.use("/console", requireConsoleJwt);
  const base = "/console/projects/:projectId";

  r.get(`${base}/incidents`, requireProject(pool, "viewer"), async (req, res) => {
    res.json(await getIncidentReport(pool, req.params.projectId!, reportQueryRange(req.query)));
  });

  r.get(`${base}/incidents/:incidentId`, requireProject(pool, "viewer"), async (req, res) => {
    const detail = await getIncidentDetail(pool, req.params.projectId!, req.params.incidentId!);
    if (!detail) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    res.json(detail);
  });

  /** Incident must be on a service this project depends on. */
  async function ownsIncident(projectId: string, incidentId: string) {
    const services = await projectServices(pool, projectId);
    const q = await pool.query<{ id: string; service: string; severity: string; title: string; status: string }>(
      `SELECT id::text, service, severity, title, status FROM incidents WHERE id::text = $1 AND service = ANY($2)`,
      [incidentId, services]
    );
    return q.rows[0] ?? null;
  }

  r.post(`${base}/incidents/:incidentId/notes`, requireProject(pool, "member"), async (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Note text is required" });
      return;
    }
    const inc = await ownsIncident(req.params.projectId!, req.params.incidentId!);
    if (!inc) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    const q = await pool.query(
      `INSERT INTO incident_notes (incident_id, body, author) VALUES ($1, $2, $3)
       RETURNING id::text, body, author, created_at`,
      [inc.id, parsed.data.body, req.consoleAuth!.email]
    );
    const n = q.rows[0];
    res.status(201).json({ id: n.id, body: n.body, author: n.author, createdAt: n.created_at });
  });

  r.patch(`${base}/incidents/:incidentId`, requireProject(pool, "admin"), async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const inc = await ownsIncident(req.params.projectId!, req.params.incidentId!);
    if (!inc) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    const by = req.consoleAuth!.email;
    if (parsed.data.status === "resolved") {
      if (inc.status === "resolved") {
        res.json({ ok: true });
        return;
      }
      const reason = parsed.data.resolution || `Manually resolved by ${by}`;
      await pool.query(
        `UPDATE incidents SET status = 'resolved', resolved_at = now(), auto_resolved = false, resolution_reason = $2
         WHERE id::text = $1`,
        [inc.id, reason]
      );
      void notifySlack(`:white_check_mark: *${inc.service}* manually resolved by ${by} — ${inc.title}\n${incidentLink(inc.id)}`);
      void emailIncidentAlert("resolved", { ...inc, resolution: reason });
    } else {
      await pool.query(`UPDATE incidents SET status = $2 WHERE id::text = $1 AND status <> 'resolved'`, [
        inc.id,
        parsed.data.status,
      ]);
    }
    broadcastSse("incident_updated", { id: inc.id, status: parsed.data.status });
    res.json({ ok: true });
  });

  r.get(`${base}/payments`, requireProject(pool, "viewer"), async (req, res) => {
    res.json(await getPaymentsReport(pool, req.params.projectId!, reportQueryRange(req.query)));
  });

  /** Tag an upstream as a payment channel (primary / backup) or another category. */
  r.patch(`${base}/upstreams/:upstreamId`, requireProject(pool, "admin"), async (req, res) => {
    const parsed = upstreamPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const p = parsed.data;
    const category = p.category;
    // Channel role only applies to payment channels.
    const role = category && category !== "payments" ? null : p.channelRole;
    const q = await pool.query(
      `UPDATE project_upstreams SET
         category = COALESCE($3, category),
         channel_role = CASE WHEN $4::boolean THEN $5 ELSE channel_role END,
         label = COALESCE($6, label)
       WHERE id::text = $1 AND project_id = $2`,
      [req.params.upstreamId, req.params.projectId, category ?? null, role !== undefined, role ?? null, p.label ?? null]
    );
    if (!q.rowCount) {
      res.status(404).json({ error: "Upstream not found" });
      return;
    }
    res.json({ ok: true });
  });

  return r;
}
