import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireJwt } from "../middleware/jwt.js";
import { requireAdmin } from "../middleware/requireAdmin.js";
import { broadcastSse } from "../sse/hub.js";
import { incidentLink, notifySlack } from "../services/notifications/slack.js";

const noteSchema = z.object({
  body: z.string().min(1),
});

const patchSchema = z.object({
  status: z.enum(["open", "investigating", "resolved"]),
});

export function incidentsRouter(pool: Pool): IRouter {
  const r = Router();

  r.get("/incidents", requireJwt, async (req, res) => {
    const scope = (req.query.scope as string) || "recent";
    let sql = `
      SELECT id, service, severity, status, opened_at, resolved_at, title, trigger_error_rate, auto_resolved
      FROM incidents
    `;
    const params: unknown[] = [];
    if (scope === "open") {
      sql += ` WHERE status IN ('open', 'investigating')`;
    }
    sql += ` ORDER BY opened_at DESC LIMIT 100`;
    const result = await pool.query(sql, params);
    res.json({ incidents: result.rows });
  });

  r.get("/incidents/:id", requireJwt, async (req, res) => {
    const id = req.params.id;
    const inc = await pool.query(
      `SELECT id, service, severity, status, opened_at, resolved_at, title, trigger_error_rate, resolution_reason, auto_resolved
       FROM incidents WHERE id = $1`,
      [id]
    );
    if (inc.rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const notes = await pool.query(
      `SELECT id, body, author, created_at FROM incident_notes WHERE incident_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    res.json({ incident: inc.rows[0], notes: notes.rows });
  });

  r.post("/incidents/:id/notes", requireJwt, requireAdmin, async (req, res) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const id = req.params.id;
    const author = req.auth?.email ?? null;
    const r2 = await pool.query(
      `INSERT INTO incident_notes (incident_id, body, author) VALUES ($1, $2, $3) RETURNING id, body, author, created_at`,
      [id, parsed.data.body, author]
    );
    res.status(201).json({ note: r2.rows[0] });
  });

  r.patch("/incidents/:id", requireJwt, requireAdmin, async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const id = req.params.id;
    const status = parsed.data.status;
    if (status === "resolved") {
      const upd = await pool.query<{ service: string; title: string }>(
        `UPDATE incidents SET status = $2, resolved_at = now(), auto_resolved = false, resolution_reason = $3
         WHERE id = $1 RETURNING service, title`,
        [id, status, "Manually resolved"]
      );
      const row = upd.rows[0];
      if (row) {
        void notifySlack(
          `:white_check_mark: *${row.service}* manually resolved by ${req.auth?.email ?? "an operator"} — ${row.title}\n${incidentLink(id)}`
        );
      }
    } else {
      await pool.query(
        `UPDATE incidents SET status = $2 WHERE id = $1`,
        [id, status]
      );
    }
    broadcastSse("incident_updated", { id, status });
    res.json({ ok: true });
  });

  return r;
}
