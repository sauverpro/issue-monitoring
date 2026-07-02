import { randomUUID } from "crypto";
import type { ServiceName } from "../constants.js";
import type { DbQueryable, DisplayStatus } from "./slidingWindow.js";

export function computeSeverity(
  rate: number,
  display: DisplayStatus
): string {
  if (display === "down") return "P1";
  if (display === "degraded" && rate >= 0.3) return "P2";
  if (display === "degraded") return "P3";
  return "P4";
}

export async function findOpenIncident(
  pool: DbQueryable,
  service: ServiceName
): Promise<{ id: string } | null> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM incidents
     WHERE service = $1 AND status IN ('open', 'investigating')
     ORDER BY opened_at DESC
     LIMIT 1`,
    [service]
  );
  return r.rows[0] ?? null;
}

export async function createIncident(
  pool: DbQueryable,
  params: {
    service: ServiceName;
    title: string;
    severity: string;
    triggerErrorRate: number;
  }
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO incidents (id, service, severity, status, opened_at, title, trigger_error_rate, auto_resolved)
     VALUES ($1, $2, $3, 'open', now(), $4, $5, false)`,
    [
      id,
      params.service,
      params.severity,
      params.title,
      params.triggerErrorRate,
    ]
  );
  return id;
}

export async function updateIncidentSeverity(
  pool: DbQueryable,
  incidentId: string,
  severity: string,
  triggerErrorRate: number,
  title: string
): Promise<void> {
  await pool.query(
    `UPDATE incidents SET severity = $2, trigger_error_rate = $3, title = $4 WHERE id = $1`,
    [incidentId, severity, triggerErrorRate, title]
  );
}

export async function resolveOpenIncident(
  pool: DbQueryable,
  service: ServiceName,
  reason: string,
  autoResolved: boolean
): Promise<string | null> {
  const open = await findOpenIncident(pool, service);
  if (!open) return null;
  await pool.query(
    `UPDATE incidents
     SET status = 'resolved', resolved_at = now(), resolution_reason = $2, auto_resolved = $3
     WHERE id = $1`,
    [open.id, reason, autoResolved]
  );
  return open.id;
}
