export const SERVICES = ["DDIN", "MVEND", "KORALINK", "INTEGRA", "RESOLVEIT"] as const;
export type ServiceName = (typeof SERVICES)[number];

export const SERVICE_LABELS: Record<ServiceName, string> = {
  DDIN: "DDIN Digital Services API",
  MVEND: "MVEND / Gwiza Payments API",
  KORALINK: "Koralink Core API",
  INTEGRA: "Integra / Intelligra API",
  RESOLVEIT: "ResolveIt Ticketing API",
};

/** Rolling window: degraded if >= this fraction */
export const RATE_DEGRADED_MIN = 0.05;
/** Rolling window: down if >= this fraction */
export const RATE_DOWN_MIN = 0.6;

/** Two consecutive 5-minute evaluation ticks below this rate → operational / auto-resolve */
export const RATE_OPERATIONAL_MAX = 0.05;

export type HealthThresholds = { degraded: number; down: number };

/**
 * Payment rails get stricter thresholds: an agent who cannot transact cannot earn,
 * so a smaller failure share opens an incident. Override with PAYMENT_SERVICES
 * (comma-separated) and PAYMENT_DEGRADED_RATE / PAYMENT_DOWN_RATE.
 */
export function paymentServices(): string[] {
  return (process.env.PAYMENT_SERVICES ?? "MVEND")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function rateEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

export function thresholdsFor(service?: string | null): HealthThresholds {
  if (service && paymentServices().includes(service.toUpperCase())) {
    return {
      degraded: rateEnv("PAYMENT_DEGRADED_RATE", 0.02),
      down: rateEnv("PAYMENT_DOWN_RATE", 0.4),
    };
  }
  return { degraded: RATE_DEGRADED_MIN, down: RATE_DOWN_MIN };
}

export const RECOVERY_TICK_MS = 5 * 60 * 1000;
export const RECOVERY_TICKS_REQUIRED = 2;

/** Active heartbeat pings against the tracked external APIs. */
export const SYNTHETIC_PING_INTERVAL_MS = 2 * 60 * 1000;
export const SYNTHETIC_PING_TIMEOUT_MS = 10_000;
/** Consecutive failing pings required before treating an upstream as unreachable (flap tolerance). */
export const SYNTHETIC_PING_FAIL_TICKS = 2;
