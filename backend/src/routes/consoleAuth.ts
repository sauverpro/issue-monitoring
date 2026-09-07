import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Pool } from "pg";
import { requireConsoleJwt, signConsoleJwt } from "../middleware/consoleJwt.js";
import { listOrgsForUser, toOrgListItem } from "../services/tenancy.js";

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  name: z.string().max(120).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function consoleAuthRouter(pool: Pool): IRouter {
  const r = Router();

  r.post("/console/auth/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const email = parsed.data.email.toLowerCase();
    const hash = await bcrypt.hash(parsed.data.password, 12);
    try {
      const q = await pool.query<{ id: string; is_platform_admin: boolean }>(
        `INSERT INTO console_users (email, password_hash, name)
         VALUES ($1, $2, $3)
         RETURNING id::text, is_platform_admin`,
        [email, hash, parsed.data.name ?? null]
      );
      const row = q.rows[0]!;
      const token = signConsoleJwt(row.id, email, row.is_platform_admin);
      const orgs = (await listOrgsForUser(pool, row.id)).map(toOrgListItem);
      res.status(201).json({
        token,
        email,
        isPlatformAdmin: row.is_platform_admin,
        orgs,
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      throw err;
    }
  });

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
    }>(
      `SELECT id::text, password_hash, is_platform_admin FROM console_users WHERE email = $1`,
      [email]
    );
    const row = q.rows[0];
    if (!row || !(await bcrypt.compare(parsed.data.password, row.password_hash))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = signConsoleJwt(row.id, email, row.is_platform_admin);
    const orgs = (await listOrgsForUser(pool, row.id)).map(toOrgListItem);
    res.json({ token, email, isPlatformAdmin: row.is_platform_admin, orgs });
  });

  r.get("/console/auth/me", requireConsoleJwt, async (req, res) => {
    const userId = req.consoleAuth!.sub;
    const orgs = (await listOrgsForUser(pool, userId)).map(toOrgListItem);
    res.json({
      email: req.consoleAuth!.email,
      isPlatformAdmin: req.consoleAuth!.isPlatformAdmin,
      orgs,
    });
  });

  return r;
}
