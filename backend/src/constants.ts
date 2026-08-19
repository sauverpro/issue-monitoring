export const SERVICES = ["DDIN", "MVEND", "KORALINK"] as const;
export type ServiceName = (typeof SERVICES)[number];

/** Rolling window: degraded if >= this fraction */
export const RATE_DEGRADED_MIN = 0.05;
/** Rolling window: down if >= this fraction */
export const RATE_DOWN_MIN = 0.6;

/** Two consecutive 5-minute evaluation ticks below this rate → operational / auto-resolve */
export const RATE_OPERATIONAL_MAX = 0.05;

export const RECOVERY_TICK_MS = 5 * 60 * 1000;
export const RECOVERY_TICKS_REQUIRED = 2;

/** Batched-delete sweep of aged-out api_events rows. */
export const RETENTION_TICK_MS = 24 * 60 * 60 * 1000;

/** Active heartbeat pings against the tracked external APIs. */
export const SYNTHETIC_PING_INTERVAL_MS = 2 * 60 * 1000;
export const SYNTHETIC_PING_TIMEOUT_MS = 10_000;
/** Consecutive failing pings required before treating an upstream as unreachable (flap tolerance). */
export const SYNTHETIC_PING_FAIL_TICKS = 2;
