import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireJwt } from "../middleware/jwt.js";
import { computeMonthlyUptime } from "../services/uptime.js";

const queryScheme = z.object({
  months: z.coerce.number().int().min(1).max(24).optional(),
});

export function uptimeRouter(pool: Pool): IRouter {
  const r = Router();

  r.get(["/api/uptime", "/uptime"], requireJwt, async (req, res) => {
    const parsed = queryScheme.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const months = await computeMonthlyUptime(pool, parsed.data.months ?? 6);
    res.json({ months });
  });

  return r;
}
