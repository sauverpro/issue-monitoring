import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { requireJwt } from "../middleware/jwt.js";
import { sentryRateLimit } from "../middleware/sentryRateLimit.js";
import { sessionIdSchema } from "../schemas/session.js";
import {
  getSessionActions,
  getSessionFailures,
  listSessions,
  getSessionAnalytics,
} from "../services/sessionInvestigation.js";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  email: z.string().optional(),
  role: z.string().optional(),
  accountType: z.string().optional(),
  status: z.enum(["all", "failures", "success"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sessionId: z.string().optional(),
});

export function apiSessionsRouter(pool: Pool): IRouter {
  const r = Router();

  r.use(["/api/sessions", "/session-investigation", "/sessions"], sentryRateLimit);

  r.get(["/api/sessions", "/session-investigation"], requireJwt, async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const q = parsed.data;
    const result = await listSessions(pool, {
      page: q.page ?? 1,
      limit: q.limit ?? 20,
      email: q.email,
      role: q.role,
      accountType: q.accountType,
      status: q.status ?? "all",
      startDate: q.startDate,
      endDate: q.endDate,
      sessionId: q.sessionId,
    });
    res.json(result.items);
  });

  r.get(["/api/sessions/analytics", "/session-investigation/analytics"], requireJwt, async (req, res) => {
    const days = z.coerce.number().int().min(1).max(30).optional().parse(req.query.days) ?? 7;
    const analytics = await getSessionAnalytics(pool, days);
    res.json(analytics);
  });

  r.get(
    [
      "/api/sessions/:sessionId/actions",
      "/session-investigation/:sessionId/actions",
      // Local Vite dev proxy strips the "/api" prefix before forwarding, so
      // the frontend's "/api/sessions/:id/actions" call lands here bare.
      "/sessions/:sessionId/actions",
    ],
    requireJwt,
    async (req, res) => {
    const parsed = sessionIdSchema.safeParse(req.params.sessionId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }
    try {
      const data = await getSessionActions(pool, parsed.data);
      if (data.actions.length === 0 && !data.user.email) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to fetch session actions",
      });
    }
  });

  r.get(
    [
      "/api/sessions/:sessionId/failures",
      "/session-investigation/:sessionId/failures",
      // Same dev-proxy rationale as the /actions route above.
      "/sessions/:sessionId/failures",
    ],
    requireJwt,
    async (req, res) => {
    const parsed = sessionIdSchema.safeParse(req.params.sessionId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid sessionId" });
      return;
    }
    try {
      const data = await getSessionFailures(pool, parsed.data);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(502).json({
        error: err instanceof Error ? err.message : "Failed to fetch session failures",
      });
    }
  });

  return r;
}
