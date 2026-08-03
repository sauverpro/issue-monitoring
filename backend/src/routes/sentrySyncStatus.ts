import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { requireJwt } from "../middleware/jwt.js";
import { config } from "../config.js";
import { fetchDiscoverEvents } from "../services/sentry/sentryClient.js";
import { normalizeSentryRow } from "../services/sentryNormalizer.js";
import { runSentryDiscoverSync } from "../services/sentrySync.js";
import type { PersistEventInput } from "../types/persistEvent.js";

const PREVIEW_LIMIT = 50;
const INGESTION_HEALTH_PERIOD_HOURS = 24;

type IngestionHealth = {
  periodHours: number;
  acceptedTotal: number;
  droppedTotal: number;
  droppedByReason: Record<string, number>;
  dropRatio: number;
  quotaExceeded: boolean;
};

type SentryStatsGroup = {
  by: { outcome?: string; reason?: string };
  totals?: { "sum(quantity)"?: number };
};

/**
 * Queries Sentry's org-level ingestion stats (accepted vs dropped/rate-limited)
 * for the "error" category — this is the category our api_success/api_failure
 * captureMessage events fall under. If Sentry's plan quota is exhausted, these
 * events get silently dropped before they're ever stored, which looks like
 * "nothing pending" in our sync status even though real traffic is happening.
 */
async function fetchIngestionHealth(): Promise<IngestionHealth> {
  const { org, baseUrl, authToken } = config.sentry;
  const params = new URLSearchParams();
  params.set("field", "sum(quantity)");
  params.append("groupBy", "outcome");
  params.append("groupBy", "reason");
  params.set("interval", `${INGESTION_HEALTH_PERIOD_HOURS}h`);
  params.set("statsPeriod", `${INGESTION_HEALTH_PERIOD_HOURS}h`);
  params.set("category", "error");

  const url = `${baseUrl}/api/0/organizations/${encodeURIComponent(org)}/stats_v2/?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${authToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Sentry stats_v2 API ${res.status}`);
  }
  const body = (await res.json()) as { groups?: SentryStatsGroup[] };

  let acceptedTotal = 0;
  let droppedTotal = 0;
  const droppedByReason: Record<string, number> = {};

  for (const g of body.groups ?? []) {
    const qty = g.totals?.["sum(quantity)"] ?? 0;
    if (g.by.outcome === "accepted") {
      acceptedTotal += qty;
      continue;
    }
    droppedTotal += qty;
    const reason = g.by.reason || g.by.outcome || "unknown";
    droppedByReason[reason] = (droppedByReason[reason] ?? 0) + qty;
  }

  const total = acceptedTotal + droppedTotal;
  const dropRatio = total > 0 ? droppedTotal / total : 0;
  const quotaExceeded =
 !!droppedByReason.error_usage_exceeded || !!droppedByReason.ratelimit_backoff;

  return {
    periodHours: INGESTION_HEALTH_PERIOD_HOURS,
    acceptedTotal,
    droppedTotal,
    droppedByReason,
    dropRatio,
    quotaExceeded,
  };
}

async function getSyncState(
  pool: Pool
): Promise<{ lastSyncedAt: Date | null; updatedAt: Date | null }> {
  const row = await pool.query<{ last_synced_at: Date | null; updated_at: Date | null }>(
    `SELECT last_synced_at, updated_at FROM sentry_sync_state WHERE id = 1`
  );
  return {
    lastSyncedAt: row.rows[0]?.last_synced_at ?? null,
    updatedAt: row.rows[0]?.updated_at ?? null,
  };
}

/** Rows from Sentry newer than our last synced watermark that would be ingested on the next sync. */
async function fetchPendingRows(lastSyncedAt: Date | null): Promise<PersistEventInput[]> {
  const query = config.sentry.discoverQuery || "has:tags[type]";
  const rows = await fetchDiscoverEvents(query, "24h");

  const pending: PersistEventInput[] = [];
  for (const row of rows) {
    const tsRaw = (row as Record<string, unknown>).timestamp;
    const ts = tsRaw ? new Date(String(tsRaw)) : null;
    if (lastSyncedAt && ts && ts <= lastSyncedAt) continue;
    const normalized = normalizeSentryRow(row);
    if (!normalized) continue;
    pending.push(normalized);
  }
  pending.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  return pending;
}

export function sentrySyncRouter(pool: Pool): IRouter {
  const r = Router();

  r.get(
    ["/api/sentry-sync/status", "/sentry-sync/status"],
    requireJwt,
    async (_req, res) => {
      const enabled = !!config.sentry.authToken;
      const { lastSyncedAt, updatedAt } = await getSyncState(pool);
      const syncIntervalMs = config.sentry.syncIntervalMs;
      const nextSyncAt = updatedAt
        ? new Date(updatedAt.getTime() + syncIntervalMs).toISOString()
        : null;

      if (!enabled) {
        res.json({
          enabled: false,
          lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
          syncIntervalMs,
          nextSyncAt,
          pendingCount: 0,
          pendingBreakdown: { SUCCESS: 0, FAILURE: 0, OTHER: 0 },
          pending: [],
          ingestionHealth: null,
        });
        return;
      }

      const ingestionHealth = await fetchIngestionHealth().catch((e) => {
        console.error("[sentry-sync] failed to fetch ingestion health", e);
        return null;
      });

      try {
        const pendingAll = await fetchPendingRows(lastSyncedAt);
        const pendingBreakdown = { SUCCESS: 0, FAILURE: 0, OTHER: 0 };
        for (const p of pendingAll) pendingBreakdown[p.outcome] += 1;

        res.json({
          enabled: true,
          lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
          syncIntervalMs,
          nextSyncAt,
          pendingCount: pendingAll.length,
          pendingBreakdown,
          ingestionHealth,
          pending: pendingAll.slice(0, PREVIEW_LIMIT).map((p) => ({
            sentryEventId: p.sentry_event_id ?? null,
            service: p.service,
            appService: p.app_service ?? null,
            endpoint: p.endpoint,
            requestUrl: p.request_url ?? null,
            outcome: p.outcome,
            statusCode: p.status_code,
            occurredAt: p.occurred_at,
            sessionId: p.session_id ?? null,
            userEmail: p.user_email ?? null,
            sentryType: p.sentry_type ?? null,
          })),
        });
      } catch (e) {
        res
          .status(502)
          .json({ error: e instanceof Error ? e.message : "Failed to query Sentry" });
      }
    }
  );

  r.post(
    ["/api/sentry-sync/run", "/sentry-sync/run"],
    requireJwt,
    async (_req, res) => {
      if (!config.sentry.authToken) {
        res
          .status(400)
          .json({ error: "Sentry sync is not configured (SENTRY_AUTH_TOKEN missing)" });
        return;
      }
      try {
        const before = await getSyncState(pool);
        await runSentryDiscoverSync(pool);
        const after = await getSyncState(pool);
        res.json({
          ok: true,
          previousSyncedAt: before.lastSyncedAt?.toISOString() ?? null,
          lastSyncedAt: after.lastSyncedAt?.toISOString() ?? null,
        });
      } catch (e) {
        res.status(502).json({ error: e instanceof Error ? e.message : "Sync failed" });
      }
    }
  );

  return r;
}
