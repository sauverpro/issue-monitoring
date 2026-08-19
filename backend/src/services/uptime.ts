import type { Pool } from "pg";
import { SERVICES, type ServiceName } from "../constants.js";

export type MonthlyUptime = {
  service: ServiceName;
  month: string; // YYYY-MM
  uptimePct: number;
  downtimeSeconds: number;
  totalSeconds: number;
};

/** Clamp an incident's [openedAt, resolvedAt) interval to a month window and return the overlap in seconds. */
export function overlapSecondsInMonth(
  openedAt: Date,
  resolvedAt: Date | null,
  monthStart: Date,
  monthEnd: Date
): number {
  const start = Math.max(openedAt.getTime(), monthStart.getTime());
  const end = Math.min((resolvedAt ?? new Date()).getTime(), monthEnd.getTime());
  return Math.max(0, (end - start) / 1000);
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Last `months` calendar months (UTC), oldest first, including the current (partial) month. */
function monthWindows(months: number): { start: Date; end: Date }[] {
  const now = new Date();
  const windows: { start: Date; end: Date }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    windows.push({ start, end: end < now ? end : now });
  }
  return windows;
}

export async function computeMonthlyUptime(
  pool: Pool,
  months = 6
): Promise<MonthlyUptime[]> {
  const windows = monthWindows(months);
  const windowStart = windows[0]!.start;
  const out: MonthlyUptime[] = [];

  for (const service of SERVICES) {
    const r = await pool.query<{ opened_at: Date; resolved_at: Date | null }>(
      `SELECT opened_at, resolved_at FROM incidents
       WHERE service = $1 AND opened_at < now() AND (resolved_at IS NULL OR resolved_at > $2)
       ORDER BY opened_at ASC`,
      [service, windowStart.toISOString()]
    );

    for (const w of windows) {
      let downtime = 0;
      for (const inc of r.rows) {
        downtime += overlapSecondsInMonth(inc.opened_at, inc.resolved_at, w.start, w.end);
      }
      const totalSeconds = Math.max(1, (w.end.getTime() - w.start.getTime()) / 1000);
      const uptimePct = Math.min(1, Math.max(0, 1 - downtime / totalSeconds));
      out.push({
        service,
        month: monthKey(w.start),
        uptimePct,
        downtimeSeconds: Math.round(downtime),
        totalSeconds: Math.round(totalSeconds),
      });
    }
  }

  return out;
}
