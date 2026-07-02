import type { Pool } from "pg";
import {
  RATE_OPERATIONAL_MAX,
  RECOVERY_TICK_MS,
  RECOVERY_TICKS_REQUIRED,
  SERVICES,
} from "../constants.js";
import { getErrorRateLast5Minutes } from "./slidingWindow.js";
import { resolveOpenIncident } from "./incidents.js";
import { broadcastSse } from "../sse/hub.js";

export function startRecoveryScheduler(pool: Pool): NodeJS.Timeout {
  return setInterval(() => {
    void runRecoveryTick(pool);
  }, RECOVERY_TICK_MS);
}

async function runRecoveryTick(pool: Pool): Promise<void> {
  for (const service of SERVICES) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const rate = await getErrorRateLast5Minutes(client, service);

      const row = await client.query<{ recovery_good_streak: string }>(
        `SELECT recovery_good_streak FROM service_health_state WHERE service = $1 FOR UPDATE`,
        [service]
      );
      let streak = Number(row.rows[0]?.recovery_good_streak ?? 0);

      if (rate < RATE_OPERATIONAL_MAX) {
        streak += 1;
      } else {
        streak = 0;
      }

      await client.query(
        `UPDATE service_health_state SET recovery_good_streak = $2, updated_at = now() WHERE service = $1`,
        [service, streak]
      );

      let resolvedId: string | null = null;
      if (streak >= RECOVERY_TICKS_REQUIRED) {
        await client.query(
          `UPDATE service_health_state SET recovery_good_streak = 0 WHERE service = $1`,
          [service]
        );
        resolvedId = await resolveOpenIncident(
          client,
          service,
          "Error rate below 5% for two consecutive 5-minute evaluations",
          true
        );
      }

      await client.query("COMMIT");

      if (resolvedId) {
        broadcastSse("incident_resolved", {
          id: resolvedId,
          service,
          autoResolved: true,
        });
      }
    } catch (e) {
      await client.query("ROLLBACK");
      console.error("recovery tick failed", service, e);
    } finally {
      client.release();
    }
  }
}
