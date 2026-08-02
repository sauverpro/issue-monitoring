import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { SERVICES } from "../constants.js";
import {
  errorRateToDisplayStatus,
  getErrorRateLast5Minutes,
  getLastSeenIso,
  listUpstreamHealth,
} from "../services/slidingWindow.js";
import { requireJwt } from "../middleware/jwt.js";
import { listTrackedApisHealth } from "../services/trackedApisHealth.js";

export function healthRouter(pool: Pool): IRouter {
  const r = Router();
  r.get(["/api/health/services", "/health/services"], requireJwt, async (_req, res) => {
    const services = await Promise.all(
      SERVICES.map(async (service) => {
        const rate = await getErrorRateLast5Minutes(pool, service);
        const status = errorRateToDisplayStatus(rate);
        const lastSeen = await getLastSeenIso(pool, service);
        return {
          service,
          status,
          error_rate_5m: rate,
          last_seen: lastSeen,
        };
      })
    );
    res.json({ services });
  });

  r.get(["/api/health/upstreams", "/health/upstreams"], requireJwt, async (_req, res) => {
    const upstreams = await listUpstreamHealth(pool);
    res.json({ upstreams });
  });

  r.get(["/api/health/tracked-apis", "/health/tracked-apis"], requireJwt, async (_req, res) => {
    const tracked_apis = await listTrackedApisHealth(pool);
    res.json({ tracked_apis });
  });

  return r;
}
