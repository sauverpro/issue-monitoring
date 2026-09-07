import type { RequestHandler } from "express";
import type { Pool } from "pg";
import { resolveProjectApiKey, touchApiKeyLastUsed } from "../services/apiKeys.js";

export function requireMonitorIngestKey(pool: Pool): RequestHandler {
  return async (req, res, next) => {
    const raw =
      req.header("x-monitor-key") ||
      req.header("authorization")?.replace(/^Bearer\s+/i, "");
    try {
      const resolved = await resolveProjectApiKey(pool, raw);
      if (!resolved) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      if (resolved.suspended) {
        res.status(403).json({ error: "Organization suspended" });
        return;
      }
      req.monitorProject = resolved;
      void touchApiKeyLastUsed(pool, resolved.keyId);
      next();
    } catch (err) {
      next(err);
    }
  };
}
