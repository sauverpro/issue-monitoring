import { Router, type IRouter } from "express";
import { z } from "zod";
import type { Pool } from "pg";
import { requireConsoleJwt, requirePlatformAdmin } from "../middleware/consoleJwt.js";
import { requireOrg } from "../middleware/consoleAuth.js";
import { slugify } from "../services/orgRoles.js";
import { listOrgsForUser, toOrgListItem } from "../services/tenancy.js";
import type { OrgRole } from "../types/consoleAuth.js";

const createOrgSchema = z.object({
  name: z.string().min(2).max(80),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "admin", "member", "viewer"]).optional(),
});

const patchMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
});

export function consoleOrgsRouter(pool: Pool): IRouter {
  const r = Router();
  r.use("/console", requireConsoleJwt);

  r.get("/console/organizations", async (req, res) => {
    const userId = req.consoleAuth!.sub;
    res.json((await listOrgsForUser(pool, userId)).map(toOrgListItem));
  });

  r.post("/console/organizations", requirePlatformAdmin, async (req, res) => {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const userId = req.consoleAuth!.sub;
    let slug = slugify(parsed.data.name);
    const exists = await pool.query(`SELECT 1 FROM organizations WHERE slug = $1`, [slug]);
    if (exists.rows.length) slug = `${slug}-${Date.now().toString(36)}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const org = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id::text`,
        [parsed.data.name.trim(), slug]
      );
      const orgId = org.rows[0]!.id;
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [orgId, userId]
      );
      await client.query("COMMIT");
      res.status(201).json({ id: orgId, name: parsed.data.name.trim(), slug, role: "owner" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  r.get("/console/organizations/:orgId", requireOrg(pool, "viewer"), async (req, res) => {
    const orgId = req.params.orgId!;
    const q = await pool.query(
      `SELECT id::text, name, slug, suspended_at, created_at FROM organizations WHERE id = $1`,
      [orgId]
    );
    const org = q.rows[0];
    if (!org) {
      res.status(404).json({ error: "Organization not found" });
      return;
    }
    res.json({
      id: org.id,
      name: org.name,
      slug: org.slug,
      suspended: org.suspended_at != null,
      createdAt: org.created_at,
      role: req.consoleMembership!.role,
    });
  });

  r.get(
    "/console/organizations/:orgId/members",
    requireOrg(pool, "viewer"),
    async (req, res) => {
      const q = await pool.query(
        `SELECT u.id::text, u.email, u.name, m.role, m.created_at
         FROM organization_members m
         JOIN console_users u ON u.id = m.user_id
         WHERE m.organization_id = $1
         ORDER BY m.created_at ASC`,
        [req.params.orgId]
      );
      res.json(
        q.rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          createdAt: row.created_at,
        }))
      );
    }
  );

  r.post(
    "/console/organizations/:orgId/members",
    requireOrg(pool, "admin"),
    async (req, res) => {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const role: OrgRole = parsed.data.role ?? "member";
      const email = parsed.data.email.toLowerCase();
      const user = await pool.query<{ id: string }>(
        `SELECT id::text FROM console_users WHERE email = $1`,
        [email]
      );
      if (!user.rows[0]) {
        res.status(404).json({
          error: "No account for that email. They must register in the organization app first.",
        });
        return;
      }
      await pool.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [req.params.orgId, user.rows[0].id, role]
      );
      res.status(201).json({ email, role });
    }
  );

  r.patch(
    "/console/organizations/:orgId/members/:userId",
    requireOrg(pool, "admin"),
    async (req, res) => {
      const parsed = patchMemberSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      await pool.query(
        `UPDATE organization_members SET role = $3
         WHERE organization_id = $1 AND user_id = $2`,
        [req.params.orgId, req.params.userId, parsed.data.role]
      );
      res.json({ ok: true });
    }
  );

  r.delete(
    "/console/organizations/:orgId/members/:userId",
    requireOrg(pool, "admin"),
    async (req, res) => {
      await pool.query(
        `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [req.params.orgId, req.params.userId]
      );
      res.status(204).end();
    }
  );

  return r;
}
