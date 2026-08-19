import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Pool } from "pg";
import { randomUUID } from "crypto";
import { requireJwt } from "../middleware/jwt.js";
import { requireAdmin } from "../middleware/requireAdmin.js";

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "viewer"]),
});

const patchSchema = z.object({
  role: z.enum(["admin", "viewer"]).optional(),
  password: z.string().min(8).optional(),
});

async function adminCount(pool: Pool): Promise<number> {
  const r = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM dashboard_users WHERE role = 'admin'`
  );
  return Number(r.rows[0]?.c ?? 0);
}

export function usersRouter(pool: Pool): IRouter {
  const r = Router();
  r.use(["/api/users", "/users"], requireJwt, requireAdmin);

  r.get(["/api/users", "/users"], async (_req, res) => {
    const result = await pool.query(
      `SELECT id, email, role, created_at FROM dashboard_users ORDER BY created_at ASC`
    );
    res.json({ users: result.rows });
  });

  r.post(["/api/users", "/users"], async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { email, password, role } = parsed.data;
    const hash = await bcrypt.hash(password, 12);
    try {
      const result = await pool.query(
        `INSERT INTO dashboard_users (id, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, email, role, created_at`,
        [randomUUID(), email, hash, role]
      );
      res.status(201).json({ user: result.rows[0] });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "23505") {
        res.status(409).json({ error: "Email already in use" });
        return;
      }
      throw e;
    }
  });

  r.patch(["/api/users/:id", "/users/:id"], async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { id } = req.params;
    const { role, password } = parsed.data;

    if (role === "viewer") {
      const target = await pool.query<{ role: string }>(
        `SELECT role FROM dashboard_users WHERE id = $1`,
        [id]
      );
      if (target.rows[0]?.role === "admin" && (await adminCount(pool)) <= 1) {
        res.status(400).json({ error: "Cannot demote the last remaining admin" });
        return;
      }
    }

    if (role) {
      await pool.query(`UPDATE dashboard_users SET role = $2 WHERE id = $1`, [id, role]);
    }
    if (password) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query(`UPDATE dashboard_users SET password_hash = $2 WHERE id = $1`, [
        id,
        hash,
      ]);
    }

    const result = await pool.query(
      `SELECT id, email, role, created_at FROM dashboard_users WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ user: result.rows[0] });
  });

  r.delete(["/api/users/:id", "/users/:id"], async (req, res) => {
    const { id } = req.params;
    if (id === req.auth?.sub) {
      res.status(400).json({ error: "Cannot delete your own account" });
      return;
    }
    const target = await pool.query<{ role: string }>(
      `SELECT role FROM dashboard_users WHERE id = $1`,
      [id]
    );
    if (target.rows.length === 0) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (target.rows[0]!.role === "admin" && (await adminCount(pool)) <= 1) {
      res.status(400).json({ error: "Cannot delete the last remaining admin" });
      return;
    }
    await pool.query(`DELETE FROM dashboard_users WHERE id = $1`, [id]);
    res.status(204).end();
  });

  return r;
}
