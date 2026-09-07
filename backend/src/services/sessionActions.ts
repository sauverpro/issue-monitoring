import type { Pool } from "pg";
import type { JourneyActionInput } from "./sentryBreadcrumbs.js";

export type PersistJourneyInput = JourneyActionInput & { project_id?: string };

export async function persistSessionActions(
  pool: Pool,
  actions: PersistJourneyInput[]
): Promise<number> {
  let inserted = 0;
  for (const a of actions) {
    if (!a.session_id) continue;
    const result = await pool.query(
      `INSERT INTO session_actions
         (session_id, occurred_at, sentry_event_id, kind, message, screen, from_screen, payload, project_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (session_id, occurred_at, kind, message) DO NOTHING`,
      [
        a.session_id,
        a.occurred_at,
        a.sentry_event_id ?? null,
        a.kind,
        a.message || "",
        a.screen ?? null,
        a.from_screen ?? null,
        JSON.stringify(a.payload ?? {}),
        a.project_id ?? null,
      ]
    );
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}
