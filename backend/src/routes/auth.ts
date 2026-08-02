import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Pool } from "pg";
import { signJwt } from "../middleware/jwt.js";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function authRouter(pool: Pool): IRouter {
  const r = Router();
  r.post(["/api/auth/login", "/auth/login"], async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { email, password } = parsed.data;
    const q = await pool.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM dashboard_users WHERE email = $1`,
      [email]
    );
    const row = q.rows[0];
    if (!row || !(await bcrypt.compare(password, row.password_hash))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = signJwt(row.id, email);
    res.json({ token, email });
  });
  return r;
}
