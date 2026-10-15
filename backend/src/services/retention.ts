import type { Pool } from "pg";

/**
 * API events are kept indefinitely for reports.
 * The old nightly DELETE sweep is disabled on purpose.
 */
export async function runRetentionSweep(_pool: Pool): Promise<number> {
  return 0;
}

export function startRetentionScheduler(_pool: Pool): NodeJS.Timeout | undefined {
  console.log("[retention] api_events kept indefinitely; nightly delete sweep is off");
  return undefined;
}
