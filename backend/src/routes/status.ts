import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { SERVICES } from "../constants.js";
import {
  errorRateToDisplayStatus,
  getErrorRateLast5Minutes,
  getLastSeenIso,
  type DisplayStatus,
} from "../services/slidingWindow.js";
import { listTrackedApisHealth } from "../services/trackedApisHealth.js";
import { computeMonthlyUptime } from "../services/uptime.js";

const STATUS_RANK: Record<DisplayStatus, number> = {
  operational: 0,
  degraded: 1,
  down: 2,
};

function worstOf(statuses: DisplayStatus[]): DisplayStatus {
  return statuses.reduce<DisplayStatus>(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    "operational"
  );
}

/** No auth — this endpoint is meant to be publicly linkable. */
export function statusRouter(pool: Pool): IRouter {
  const r = Router();

  r.get(["/api/status", "/status"], async (_req, res) => {
    const services = await Promise.all(
      SERVICES.map(async (service) => {
        const rate = await getErrorRateLast5Minutes(pool, service);
        const status = errorRateToDisplayStatus(rate);
        const lastSeen = await getLastSeenIso(pool, service);
        return { service, status, last_seen: lastSeen };
      })
    );

    const trackedApis = await listTrackedApisHealth(pool);

    const incidents = await pool.query(
      `SELECT id, service, severity, status, title, opened_at, resolved_at
       FROM incidents ORDER BY opened_at DESC LIMIT 20`
    );

    const uptime = (await computeMonthlyUptime(pool, 1)).map((m) => ({
      service: m.service,
      uptimePct: m.uptimePct,
    }));

    const overall = worstOf([
      ...services.map((s) => s.status),
      ...trackedApis.map((a) => a.status),
    ]);

    res.json({
      overall,
      services,
      tracked_apis: trackedApis.map((a) => ({
        id: a.id,
        label: a.label,
        status: a.status,
        last_seen: a.last_seen,
      })),
      incidents: incidents.rows,
      uptime_this_month: uptime,
      generated_at: new Date().toISOString(),
    });
  });

  return r;
}
