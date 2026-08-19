import type { Pool } from "pg";
import { RETENTION_TICK_MS } from "../constants.js";
import { config } from "../config.js";

const BATCH_SIZE = 5000;

/** Batched delete so a large backlog doesn't hold one long-lived lock. */
export async function runRetentionSweep(pool: Pool): Promise<number> {
  let total = 0;
  for (;;) {
    const r = await pool.query(
      `DELETE FROM api_events
       WHERE id IN (
         SELECT id FROM api_events
         WHERE occurred_at < now() - ($1 || ' days')::interval
         LIMIT $2
       )`,
      [config.retentionDays, BATCH_SIZE]
    );
    total += r.rowCount ?? 0;
    if ((r.rowCount ?? 0) < BATCH_SIZE) break;
  }
  if (total > 0) {
    console.log(`[retention] deleted ${total} api_events rows older than ${config.retentionDays}d`);
  }
  return total;
}

function safeSweep(pool: Pool): void {
  runRetentionSweep(pool).catch((e) => console.error("[retention] sweep failed", e));
}

export function startRetentionScheduler(pool: Pool): NodeJS.Timeout {
  safeSweep(pool);
  return setInterval(() => safeSweep(pool), RETENTION_TICK_MS);
}
