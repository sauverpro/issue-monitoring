import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Pool } from "pg";
import { requireConsoleJwt, signConsoleJwt } from "../middleware/consoleJwt.js";
import { listOrgsForUser, toOrgListItem } from "../services/tenancy.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export function consoleAuthRouter(pool: Pool): IRouter {
  const r = Router();

  // There is no public sign-up: platform admins are seeded (scripts/seed.ts) and
  // every other account is provisioned by an org admin via
  // POST /console/organizations/:orgId/members.

  r.post("/console/auth/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    const q = await pool.query<{
      id: string;
      password_hash: string;
      is_platform_admin: boolean;
      must_change_password: boolean;
    }>(
      `SELECT id::text, password_hash, is_platform_admin, must_change_password
       FROM console_users WHERE email = $1`,
      [email]
    );
    const row = q.rows[0];
    if (!row || !(await bcrypt.compare(parsed.data.password, row.password_hash))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = signConsoleJwt(row.id, email, row.is_platform_admin);
    const orgs = (await listOrgsForUser(pool, row.id)).map(toOrgListItem);
    res.json({
      token,
      email,
      isPlatformAdmin: row.is_platform_admin,
      mustChangePassword: row.must_change_password,
      orgs,
    });
  });

  r.get("/console/auth/me", requireConsoleJwt, async (req, res) => {
    const userId = req.consoleAuth!.sub;
    const q = await pool.query<{ must_change_password: boolean; is_platform_admin: boolean }>(
      `SELECT must_change_password, is_platform_admin FROM console_users WHERE id = $1`,
      [userId]
    );
    const row = q.rows[0];
    if (!row) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const orgs = (await listOrgsForUser(pool, userId)).map(toOrgListItem);
    res.json({
      email: req.consoleAuth!.email,
      // Read the flag live so revoking platform admin takes effect without re-login.
      isPlatformAdmin: row.is_platform_admin,
      mustChangePassword: row.must_change_password,
      orgs,
    });
  });

  r.post("/console/auth/change-password", requireConsoleJwt, async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const userId = req.consoleAuth!.sub;
    const q = await pool.query<{ password_hash: string }>(
      `SELECT password_hash FROM console_users WHERE id = $1`,
      [userId]
    );
    const row = q.rows[0];
    if (!row || !(await bcrypt.compare(parsed.data.currentPassword, row.password_hash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    if (parsed.data.currentPassword === parsed.data.newPassword) {
      res.status(400).json({ error: "New password must differ from the current one" });
      return;
    }
    const hash = await bcrypt.hash(parsed.data.newPassword, 12);
    await pool.query(
      `UPDATE console_users SET password_hash = $2, must_change_password = false WHERE id = $1`,
      [userId, hash]
    );
    res.json({ ok: true });
  });

  return r;
}
