import type { Pool } from "pg";
import { config } from "../config.js";
import { SENTRY_DISCOVER_FIELDS } from "./sentry/discoverFields.js";
import { enqueueSentryPayload } from "./eventQueue.js";

const DISCOVER_FIELDS = [...SENTRY_DISCOVER_FIELDS];

export async function runSentryDiscoverSync(pool: Pool): Promise<void> {
  const { authToken, org, discoverQuery } = config.sentry;
  if (!authToken) return;

  const stateRow = await pool.query<{ last_synced_at: Date | null }>(
    `SELECT last_synced_at FROM sentry_sync_state WHERE id = 1`
  );
  const lastSynced = stateRow.rows[0]?.last_synced_at;

  const params = new URLSearchParams();
  for (const f of DISCOVER_FIELDS) {
    params.append("field", f);
  }
  if (discoverQuery) {
    params.set("query", discoverQuery);
  }
  params.set("sort", "-timestamp");
  params.set("per_page", "100");
  params.set("statsPeriod", "24h");

  let url: string | null =
    `${config.sentry.baseUrl}/api/0/organizations/${encodeURIComponent(org)}/events/?${params.toString()}`;

  let newest: Date | null = null;
  let totalAccepted = 0;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[sentry-sync] Discover API error", res.status, text.slice(0, 200));
      break;
    }

    const body = (await res.json()) as { data?: unknown[] };
    const rows = body.data ?? [];
    if (rows.length === 0) break;

    let hitOld = false;
    for (const row of rows) {
      const ts = (row as Record<string, unknown>).timestamp;
      const occurred = ts ? new Date(String(ts)) : null;
      if (occurred && lastSynced && occurred <= lastSynced) {
        hitOld = true;
        continue;
      }
      if (occurred && (!newest || occurred > newest)) {
        newest = occurred;
      }
      totalAccepted += enqueueSentryPayload({ data: [row] });
    }

    if (hitOld && rows.length < 100) break;

    const link = res.headers.get("link");
    url = parseNextLink(link);
    if (hitOld) break;
  }

  if (newest) {
    await pool.query(
      `UPDATE sentry_sync_state SET last_synced_at = $1, updated_at = now() WHERE id = 1`,
      [newest.toISOString()]
    );
  }

  if (totalAccepted > 0) {
    console.log(`[sentry-sync] queued ${totalAccepted} events`);
  }
}

function parseNextLink(link: string | null): string | null {
  if (!link) return null;
  const parts = link.split(",");
  for (const part of parts) {
    if (part.includes('rel="next"') && part.includes('results="true"')) {
      const m = part.match(/<([^>]+)>/);
      return m?.[1] ?? null;
    }
  }
  return null;
}

function safeSync(pool: Pool): void {
  runSentryDiscoverSync(pool).catch((e) => console.error("[sentry-sync] run failed", e));
}

export function startSentrySyncScheduler(pool: Pool): NodeJS.Timeout | null {
  if (!config.sentry.authToken) {
    console.log("[sentry-sync] disabled (SENTRY_AUTH_TOKEN not set)");
    return null;
  }
  const ms = config.sentry.syncIntervalMs;
  console.log(`[sentry-sync] polling every ${ms / 1000}s`);
  safeSync(pool);
  return setInterval(() => safeSync(pool), ms);
}
