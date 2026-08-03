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
