import type { Pool } from "pg";
import { config } from "../config.js";
import { SENTRY_DISCOVER_FIELDS } from "./sentry/discoverFields.js";
import { enqueueSentryPayload, enqueuePersistEvent } from "./eventQueue.js";
import { fetchHttpClientSpans, fetchSentryEventDetail } from "./sentry/sentryClient.js";
import {
  normalizeHttpSpan,
  normalizeSentryRow,
} from "./sentryNormalizer.js";
import {
  applyEnrichment,
  enrichmentFromBreadcrumbs,
  journeyActionsFromBreadcrumbs,
} from "./sentryBreadcrumbs.js";
import { persistSessionActions } from "./sessionActions.js";
import type { PersistEventInput } from "../types/persistEvent.js";

const DISCOVER_FIELDS = [...SENTRY_DISCOVER_FIELDS];
const MAX_FAILED_SPAN_ENRICH = 15;

export async function runSentryDiscoverSync(pool: Pool): Promise<void> {
  const { authToken, org, discoverQuery } = config.sentry;
  if (!authToken) return;

  const stateRow = await pool.query<{ last_synced_at: Date | null }>(
    `SELECT last_synced_at FROM sentry_sync_state WHERE id = 1`
  );
  const lastSynced = stateRow.rows[0]?.last_synced_at;

  let newest: Date | null = null;
  let totalAccepted = 0;

  const tagged = await pullDiscoverPages(
    `${config.sentry.baseUrl}/api/0/organizations/${encodeURIComponent(org)}/events/?${discoverParams(discoverQuery)}`,
    lastSynced
  );
  newest = maxDate(newest, tagged.newest);
  totalAccepted += tagged.accepted;

  try {
    const spanRows = await fetchHttpClientSpans("24h");
    const spanResult = await ingestSpanRows(pool, spanRows, lastSynced);
    newest = maxDate(newest, spanResult.newest);
    totalAccepted += spanResult.accepted;
  } catch (err) {
    console.error("[sentry-sync] span ingest failed", err);
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

function discoverParams(discoverQuery: string): string {
  const params = new URLSearchParams();
  for (const f of DISCOVER_FIELDS) {
    params.append("field", f);
  }
  if (discoverQuery) params.set("query", discoverQuery);
  params.set("sort", "-timestamp");
  params.set("per_page", "100");
  params.set("statsPeriod", "24h");
  return params.toString();
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

async function pullDiscoverPages(
  startUrl: string,
  lastSynced: Date | null
): Promise<{ newest: Date | null; accepted: number }> {
  const { authToken } = config.sentry;
  let url: string | null = startUrl;
  let newest: Date | null = null;
  let accepted = 0;

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
      if (occurred && (!newest || occurred > newest)) newest = occurred;
      accepted += enqueueSentryPayload({ data: [row] });
    }

    if (hitOld && rows.length < 100) break;
    url = parseNextLink(res.headers.get("link"));
    if (hitOld) break;
  }

  return { newest, accepted };
}

async function ingestSpanRows(
  pool: Pool,
  rows: unknown[],
  lastSynced: Date | null
): Promise<{ newest: Date | null; accepted: number }> {
  let newest: Date | null = null;
  let accepted = 0;
  let enrichLeft = MAX_FAILED_SPAN_ENRICH;

  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    if (!row["span.op"] && (row["span.description"] || row["transaction"])) {
      row["span.op"] = "http.client";
    }
    const ts = row.timestamp;
    const occurred = ts ? new Date(String(ts)) : null;
    if (occurred && lastSynced && occurred <= lastSynced) continue;
    if (occurred && (!newest || occurred > newest)) newest = occurred;

    let event = normalizeHttpSpan(row) ?? normalizeSentryRow(row);
    if (!event) continue;

    const txnId = String(row["transaction.event_id"] ?? "");
    const failed = event.outcome === "FAILURE" || event.outcome === "OTHER";
    if (failed && txnId && enrichLeft > 0) {
      enrichLeft -= 1;
      try {
        const detail = await fetchSentryEventDetail(txnId);
        if (detail) {
          event = applyEnrichment(
            event,
            enrichmentFromBreadcrumbs(detail, event.request_url)
          );
          const journeys = journeyActionsFromBreadcrumbs(
            detail,
            event.session_id ?? "",
            txnId
          );
          if (journeys.length) {
            await persistSessionActions(pool, journeys);
          }
        }
      } catch (err) {
        console.warn("[sentry-sync] failed span enrichment", txnId, err);
      }
    }

    enqueuePersistEvent(event);
    accepted += 1;
  }

  return { newest, accepted };
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

/** Used by sync-status preview to include span rows. */
export function normalizeAnySentryRow(row: Record<string, unknown>): PersistEventInput | null {
  return normalizeSentryRow(row);
}
