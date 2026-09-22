import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Pool } from "pg";
import { requireConsoleJwt, requirePlatformAdmin } from "../middleware/consoleJwt.js";
import { requireOrg } from "../middleware/consoleAuth.js";
import { generateTempPassword, slugify } from "../services/orgRoles.js";
import { listOrgsForUser, setMemberProjects, toOrgListItem } from "../services/tenancy.js";
import type { OrgRole } from "../types/consoleAuth.js";

const createOrgSchema = z.object({
  name: z.string().min(2).max(80),
});

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().max(120).optional(),
  role: z.enum(["admin", "viewer"]).default("viewer"),
  projectIds: z.array(z.string().uuid()).optional(),
});

const patchMemberSchema = z.object({
  role: z.enum(["admin", "viewer"]).optional(),
  name: z.string().max(120).nullable().optional(),
  projectIds: z.array(z.string().uuid()).optional(),
});

export function consoleOrgsRouter(pool: Pool): IRouter {
  const r = Router();
  r.use("/console", requireConsoleJwt);

  r.get("/console/organizations", async (req, res) => {
    const userId = req.consoleAuth!.sub;
    res.json((await listOrgsForUser(pool, userId)).map(toOrgListItem));
  });

  /** Platform admins create orgs without joining them as members. */
  r.post("/console/organizations", requirePlatformAdmin, async (req, res) => {
    const parsed = createOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    let slug = slugify(parsed.data.name);
    const exists = await pool.query(`SELECT 1 FROM organizations WHERE slug = $1`, [slug]);
    if (exists.rows.length) slug = `${slug}-${Date.now().toString(36)}`;
    const org = await pool.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id::text`,
      [parsed.data.name.trim(), slug]
    );
    res.status(201).json({
      id: org.rows[0]!.id,
      name: parsed.data.name.trim(),
      slug,
      role: "owner",
    });
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

  /** Members list — platform admins are never returned. Admin+ only. */
  r.get(
    "/console/organizations/:orgId/members",
    requireOrg(pool, "admin"),
    async (req, res) => {
      const orgId = req.params.orgId!;
      const q = await pool.query(
        `SELECT u.id::text, u.email, u.name, u.must_change_password,
                m.role, m.created_at,
                COALESCE(
                  (SELECT array_agg(pm.project_id::text ORDER BY p.name)
                   FROM project_members pm
                   JOIN projects p ON p.id = pm.project_id
                   WHERE pm.user_id = u.id AND p.organization_id = $1),
                  '{}'
                ) AS project_ids
         FROM organization_members m
         JOIN console_users u ON u.id = m.user_id
         WHERE m.organization_id = $1
           AND u.is_platform_admin = false
         ORDER BY m.created_at ASC`,
        [orgId]
      );
      res.json(
        q.rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          role: row.role,
          createdAt: row.created_at,
          pendingFirstLogin: row.must_change_password,
          projectIds: row.project_ids as string[],
        }))
      );
    }
  );

  /**
   * Provision a member. Unknown emails create an account + one-time password.
   * Platform-admin accounts cannot be added to organizations.
   */
  r.post(
    "/console/organizations/:orgId/members",
    requireOrg(pool, "admin"),
    async (req, res) => {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      const role: OrgRole = parsed.data.role;
      const email = parsed.data.email.toLowerCase();
      const orgId = req.params.orgId!;
      const projectIds = parsed.data.projectIds ?? [];

      if (role === "viewer" && projectIds.length === 0) {
        res.status(400).json({ error: "Assign at least one project for a viewer" });
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const existing = await client.query<{ id: string; is_platform_admin: boolean }>(
          `SELECT id::text, is_platform_admin FROM console_users WHERE email = $1`,
          [email]
        );

        if (existing.rows[0]?.is_platform_admin) {
          await client.query("ROLLBACK");
          res.status(400).json({
            error: "Platform admins are not organization members",
          });
          return;
        }

        let userId = existing.rows[0]?.id;
        let temporaryPassword: string | null = null;
        if (!userId) {
          temporaryPassword = generateTempPassword();
          const hash = await bcrypt.hash(temporaryPassword, 12);
          const created = await client.query<{ id: string }>(
            `INSERT INTO console_users (email, password_hash, name, must_change_password, created_by)
             VALUES ($1, $2, $3, true, $4)
             RETURNING id::text`,
            [email, hash, parsed.data.name?.trim() || null, req.consoleAuth!.sub]
          );
          userId = created.rows[0]!.id;
        }

        await client.query(
          `INSERT INTO organization_members (organization_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [orgId, userId, role]
        );
        await setMemberProjects(client, orgId, userId, role === "viewer" ? projectIds : []);
        await client.query("COMMIT");
        res.status(201).json({
          id: userId,
          email,
          role,
          projectIds: role === "viewer" ? projectIds : [],
          created: temporaryPassword != null,
          temporaryPassword,
        });
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
  );

  r.post(
    "/console/organizations/:orgId/members/:userId/reset-password",
    requireOrg(pool, "admin"),
    async (req, res) => {
      const orgId = req.params.orgId!;
      const userId = req.params.userId!;
      const member = await pool.query<{ email: string; is_platform_admin: boolean }>(
        `SELECT u.email, u.is_platform_admin FROM organization_members m
         JOIN console_users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.user_id = $2`,
        [orgId, userId]
      );
      if (!member.rows[0] || member.rows[0].is_platform_admin) {
        res.status(404).json({ error: "Member not found" });
        return;
      }
      const temporaryPassword = generateTempPassword();
      const hash = await bcrypt.hash(temporaryPassword, 12);
      await pool.query(
        `UPDATE console_users SET password_hash = $2, must_change_password = true WHERE id = $1`,
        [userId, hash]
      );
      res.json({ email: member.rows[0].email, temporaryPassword });
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
      if (req.params.userId === req.consoleAuth!.sub) {
        res.status(400).json({ error: "You cannot change your own role" });
        return;
      }
      const orgId = req.params.orgId!;
      const userId = req.params.userId!;

      const existing = await pool.query<{ role: OrgRole; is_platform_admin: boolean }>(
        `SELECT m.role, u.is_platform_admin
         FROM organization_members m
         JOIN console_users u ON u.id = m.user_id
         WHERE m.organization_id = $1 AND m.user_id = $2`,
        [orgId, userId]
      );
      if (!existing.rows[0] || existing.rows[0].is_platform_admin) {
        res.status(404).json({ error: "Member not found" });
        return;
      }

      const nextRole = parsed.data.role ?? existing.rows[0].role;
      if (parsed.data.role) {
        await pool.query(
          `UPDATE organization_members SET role = $3
           WHERE organization_id = $1 AND user_id = $2`,
          [orgId, userId, parsed.data.role]
        );
      }
      if (parsed.data.name !== undefined) {
        await pool.query(`UPDATE console_users SET name = $2 WHERE id = $1`, [
          userId,
          parsed.data.name,
        ]);
      }

      if (nextRole === "viewer") {
        const projectIds = parsed.data.projectIds;
        if (projectIds !== undefined) {
          if (projectIds.length === 0) {
            res.status(400).json({ error: "Assign at least one project for a viewer" });
            return;
          }
          await setMemberProjects(pool, orgId, userId, projectIds);
        }
      } else {
        await setMemberProjects(pool, orgId, userId, []);
      }

      res.json({ ok: true });
    }
  );

  r.delete(
    "/console/organizations/:orgId/members/:userId",
    requireOrg(pool, "admin"),
    async (req, res) => {
      if (req.params.userId === req.consoleAuth!.sub) {
        res.status(400).json({ error: "You cannot remove yourself from the organization" });
        return;
      }
      await pool.query(
        `DELETE FROM project_members pm
         USING projects p
         WHERE pm.project_id = p.id AND p.organization_id = $1 AND pm.user_id = $2`,
        [req.params.orgId, req.params.userId]
      );
      await pool.query(
        `DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [req.params.orgId, req.params.userId]
      );
      res.status(204).end();
    }
  );

  return r;
}
