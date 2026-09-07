import { Router, type IRouter } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { requireConsoleJwt, requirePlatformAdmin } from "../middleware/consoleJwt.js";
import { listOrgUsage } from "../services/monitorMetrics.js";
import { slugify } from "../services/orgRoles.js";

const createSchema = z.object({
  name: z.string().min(2).max(80),
});

export function consoleAdminRouter(pool: Pool): IRouter {
  const r = Router();
  r.use("/console/admin", requireConsoleJwt, requirePlatformAdmin);

  r.get("/console/admin/organizations", async (_req, res) => {
    res.json(await listOrgUsage(pool));
  });

  r.post("/console/admin/organizations", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    let slug = slugify(parsed.data.name);
    const exists = await pool.query(`SELECT 1 FROM organizations WHERE slug = $1`, [slug]);
    if (exists.rows.length) slug = `${slug}-${Date.now().toString(36)}`;
    const q = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id::text`,
      [parsed.data.name.trim(), slug]
    );
    res.status(201).json({ id: q.rows[0]!.id, name: parsed.data.name.trim(), slug });
  });

  r.post("/console/admin/organizations/:orgId/suspend", async (req, res) => {
    await pool.query(
      `UPDATE organizations SET suspended_at = now() WHERE id = $1 AND suspended_at IS NULL`,
      [req.params.orgId]
    );
    res.json({ ok: true });
  });

  r.post("/console/admin/organizations/:orgId/unsuspend", async (req, res) => {
    await pool.query(`UPDATE organizations SET suspended_at = NULL WHERE id = $1`, [
      req.params.orgId,
    ]);
    res.json({ ok: true });
  });

  return r;
}
