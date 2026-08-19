import type { Pool } from "pg";
import {
  SYNTHETIC_PING_FAIL_TICKS,
  SYNTHETIC_PING_INTERVAL_MS,
  SYNTHETIC_PING_TIMEOUT_MS,
} from "../constants.js";
import { trackedApiDefinitions } from "./trackedApisHealth.js";
import { broadcastSse } from "../sse/hub.js";
import { notifySlack } from "./notifications/slack.js";

export type PingTransition = "none" | "down" | "recovered";

/** Pure state-machine step: decides whether a ping result crosses the alert threshold. */
export function classifyPingResult(
  prevOk: boolean,
  failStreak: number,
  ok: boolean,
  threshold: number
): { nextFailStreak: number; transition: PingTransition } {
  if (ok) {
    const transition: PingTransition = !prevOk && failStreak >= threshold ? "recovered" : "none";
    return { nextFailStreak: 0, transition };
  }
  const nextFailStreak = failStreak + 1;
  const transition: PingTransition =
    prevOk && nextFailStreak >= threshold ? "down" : "none";
  return { nextFailStreak, transition };
}

async function pingOne(baseUrl: string): Promise<{
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  errorMessage: string | null;
}> {
  const started = Date.now();
  try {
    const res = await fetch(baseUrl, {
      method: "GET",
      signal: AbortSignal.timeout(SYNTHETIC_PING_TIMEOUT_MS),
    });
    return {
      ok: true,
      statusCode: res.status,
      latencyMs: Date.now() - started,
      errorMessage: null,
    };
  } catch (e) {
    return {
      ok: false,
      statusCode: null,
      latencyMs: null,
      errorMessage: e instanceof Error ? e.message : "Unknown error",
    };
  }
}

export async function runSyntheticSweep(pool: Pool): Promise<void> {
  for (const def of trackedApiDefinitions()) {
    const result = await pingOne(def.baseUrl);

    await pool.query(
      `INSERT INTO synthetic_checks (api_id, ok, status_code, latency_ms, error_message)
       VALUES ($1, $2, $3, $4, $5)`,
      [def.id, result.ok, result.statusCode, result.latencyMs, result.errorMessage]
    );

    await pool.query(
      `INSERT INTO synthetic_check_state (api_id) VALUES ($1) ON CONFLICT (api_id) DO NOTHING`,
      [def.id]
    );
    const stateRow = await pool.query<{ prev_ok: boolean; fail_streak: number }>(
      `SELECT prev_ok, fail_streak FROM synthetic_check_state WHERE api_id = $1`,
      [def.id]
    );
    const state = stateRow.rows[0]!;

    const { nextFailStreak, transition } = classifyPingResult(
      state.prev_ok,
      state.fail_streak,
      result.ok,
      SYNTHETIC_PING_FAIL_TICKS
    );

    const nextOk = transition === "down" ? false : transition === "recovered" ? true : state.prev_ok;

    await pool.query(
      `UPDATE synthetic_check_state SET prev_ok = $2, fail_streak = $3, updated_at = now() WHERE api_id = $1`,
      [def.id, nextOk, nextFailStreak]
    );

    if (transition === "down") {
      broadcastSse("synthetic_status", { id: def.id, label: def.label, reachable: false });
      void notifySlack(
        `:satellite: *${def.label}* is unreachable — no response from ${def.baseUrl} for ${SYNTHETIC_PING_FAIL_TICKS} consecutive checks`
      );
    } else if (transition === "recovered") {
      broadcastSse("synthetic_status", { id: def.id, label: def.label, reachable: true });
      void notifySlack(`:satellite: *${def.label}* is reachable again (${def.baseUrl})`);
    }
  }
}

function safeSweep(pool: Pool): void {
  runSyntheticSweep(pool).catch((e) => console.error("[synthetic-ping] sweep failed", e));
}

export function startSyntheticPingScheduler(pool: Pool): NodeJS.Timeout {
  safeSweep(pool);
  return setInterval(() => safeSweep(pool), SYNTHETIC_PING_INTERVAL_MS);
}
