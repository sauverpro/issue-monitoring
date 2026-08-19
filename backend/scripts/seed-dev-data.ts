/**
 * Destructive dev/demo seed: clears api_events, incidents, incident_notes;
 * repopulates sample traffic in Postgres, resets service_health_state, plus manual incidents/notes.
 *
 * Requires: migrations applied (including service_health_state), Postgres reachable.
 *
 * Run: SEED_DEV_DATA=true npm run db:seed:dev -w backend
 */

import dotenv from "dotenv";
import { resolve } from "path";
import { randomUUID } from "crypto";
import pg from "pg";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../.env") });

async function main() {
  if (process.env.SEED_DEV_DATA !== "true") {
    console.error(
      "Refusing to run: set SEED_DEV_DATA=true (wipes api_events, incidents, incident_notes)."
    );
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { SERVICES } = await import("../src/constants.js");
  const {
    getErrorRateLast5Minutes,
    getErrorRateLast5MinutesForUpstream,
    errorRateToDisplayStatus,
  } = await import("../src/services/slidingWindow.js");
  type ServiceName = (typeof SERVICES)[number];

  const pool = new pg.Pool({ connectionString: databaseUrl });

  console.log("Truncating event & incident tables…");
  await pool.query(
    "TRUNCATE incident_notes, incidents, upstream_health_state, api_events RESTART IDENTITY CASCADE"
  );

  console.log("Resetting service_health_state…");
  await pool.query(
    `UPDATE service_health_state
     SET prev_display_status = 'operational', recovery_good_streak = 0, updated_at = now()`
  );

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  function upstreamKeyFromEndpoint(endpoint: string): string {
    const base = endpoint.split("?")[0]?.trim() ?? "";
    const slug = base
      .replace(/^\/+/, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toLowerCase()
      .replace(/^_+|_+$/g, "");
    return slug.length > 0 ? slug.slice(0, 128) : "unknown";
  }

  function outcomeFromStatus(status_code: number): "SUCCESS" | "FAILURE" | "OTHER" {
    if (status_code === 0) return "OTHER";
    if (status_code >= 200 && status_code < 300) return "SUCCESS";
    return "FAILURE";
  }

  type Row = {
    service: ServiceName;
    upstream_key: string;
    outcome: "SUCCESS" | "FAILURE" | "OTHER";
    endpoint: string;
    request_url: string | null;
    status_code: number;
    latency_ms: number;
    error_code: string | null;
    source: "mobile" | "web";
    session_id: string | null;
    occurred_at: Date;
    response_body: string | null;
  };

  const API_BASE: Record<ServiceName, { base: string; paths: string[] }> = {
    MVEND: {
      base: "https://openapi.gwiza.tech",
      paths: ["/wallet/topup", "/payments/init", "/mvend/balance"],
    },
    KORALINK: {
      base: "https://www.djyh.rw/api/v1",
      paths: ["/orders", "/health", "/catalog"],
    },
    DDIN: {
      base: "https://core-api.ddin.rw/v1",
      paths: ["/agency/verify", "/agency/status", "/agency/documents"],
    },
    INTEGRA: {
      base: "https://rw-prod.intelligra.io/intelligrapi",
      paths: ["/phones", "/lookup", "/status"],
    },
    RESOLVEIT: {
      base: "https://resolveit.rw",
      paths: ["/tickets", "/api/tickets", "/health"],
    },
  };

  const rows: Row[] = [];

  for (let i = 0; i < 280; i++) {
    const t = new Date(now - Math.random() * sevenDaysMs);
    const service = SERVICES[i % SERVICES.length]!;
    const source: "mobile" | "web" = i % 2 === 0 ? "mobile" : "web";
    const failRoll = i % 11;
    const status_code =
      failRoll === 0
        ? 500
        : failRoll === 1
          ? 503
          : failRoll === 2
            ? 401
            : i % 53 === 0
              ? 0
              : 200;
    const error_code =
      status_code >= 500
        ? "UPSTREAM_ERROR"
        : status_code === 401
          ? "AUTH_FAILED"
          : null;

    const api = API_BASE[service];
    const endpoint = api.paths[i % api.paths.length]!;
    const request_url = `${api.base}${endpoint}`;

    const latency_ms = Math.max(
      5,
      Math.round(40 + Math.random() * 800 + (status_code >= 400 ? 400 : 0))
    );

    const bodyObj =
      status_code >= 400
        ? { error: "upstream_failed", traceId: `tr-${i}` }
        : { ok: true, latency_ms: latency_ms };

    const upstream_key = upstreamKeyFromEndpoint(endpoint);
    rows.push({
      service,
      upstream_key,
      outcome: outcomeFromStatus(status_code),
      endpoint,
      request_url,
      status_code,
      latency_ms,
      error_code,
      source,
      session_id: i % 9 === 0 ? `sess_${i}` : null,
      occurred_at: t,
      response_body: JSON.stringify(bodyObj),
    });
  }

  for (let j = 0; j < 35; j++) {
    const t = new Date(now - j * 5000);
    const service = SERVICES[j % SERVICES.length]!;
    const bad = j < 12;
    const status_code = bad ? 500 : 200;
    const api = API_BASE[service];
    const endpoint = api.paths[0]!;
    const request_url = `${api.base}${endpoint}`;
    rows.push({
      service,
      upstream_key: upstreamKeyFromEndpoint(endpoint),
      outcome: outcomeFromStatus(status_code),
      endpoint,
      request_url,
      status_code,
      latency_ms: bad ? 1200 + j * 20 : 80 + j,
      error_code: bad ? "TIMEOUT" : null,
      source: j % 2 === 0 ? "web" : "mobile",
      session_id: null,
      occurred_at: t,
      response_body: JSON.stringify(
        bad ? { error: "timeout" } : { status: "ok" }
      ),
    });
  }

  console.log(`Inserting ${rows.length} api_events…`);
  const chunk = 80;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let n = 1;
    for (const r of part) {
      placeholders.push(
        `($${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++},$${n++})`
      );
      vals.push(
        r.service,
        r.endpoint,
        r.request_url,
        r.status_code,
        r.latency_ms,
        r.error_code,
        r.source,
        r.session_id,
        r.occurred_at.toISOString(),
        r.response_body,
        r.upstream_key,
        r.outcome
      );
    }
    await pool.query(
      `INSERT INTO api_events
        (service, endpoint, request_url, status_code, latency_ms, error_code, source, session_id, occurred_at, response_body, upstream_key, outcome)
       VALUES ${placeholders.join(",")}`,
      vals
    );
  }

  await pool.query(
    `INSERT INTO upstream_health_state (service, upstream_key, prev_display_status, updated_at)
     SELECT DISTINCT service, upstream_key, 'operational', now() FROM api_events
     ON CONFLICT (service, upstream_key) DO NOTHING`
  );

  console.log("Syncing service_health_state from 5m SQL windows…");
  for (const svc of SERVICES) {
    const rate = await getErrorRateLast5Minutes(pool, svc);
    const d = errorRateToDisplayStatus(rate);
    await pool.query(
      `UPDATE service_health_state SET prev_display_status = $2, updated_at = now() WHERE service = $1`,
      [svc, d]
    );
  }

  console.log("Syncing upstream_health_state from 5m SQL windows…");
  const distinctUp = await pool.query<{ service: string; upstream_key: string }>(
    `SELECT DISTINCT service, upstream_key FROM api_events`
  );
  for (const u of distinctUp.rows) {
    const rate = await getErrorRateLast5MinutesForUpstream(
      pool,
      u.service as ServiceName,
      u.upstream_key
    );
    const d = errorRateToDisplayStatus(rate);
    await pool.query(
      `UPDATE upstream_health_state SET prev_display_status = $3, updated_at = now()
       WHERE service = $1 AND upstream_key = $2`,
      [u.service, u.upstream_key, d]
    );
  }

  console.log("Inserting sample incidents & notes…");
  const incOpen = randomUUID();
  const incInvest = randomUUID();
  const incResolved = randomUUID();

  await pool.query(
    `INSERT INTO incidents
      (id, service, severity, status, opened_at, resolved_at, title, trigger_error_rate, resolution_reason, auto_resolved)
     VALUES
      ($1,'MVEND','P2','open', now() - interval '25 minutes', NULL,
       'MVEND wallet top-up failures spiking (seed)', 0.28, NULL, false),
      ($2,'INTEGRA','P3','investigating', now() - interval '3 hours', NULL,
       'Integra phone lookup intermittent 401s (seed)', 0.12, NULL, false),
      ($3,'RESOLVEIT','P4','resolved', now() - interval '5 days', now() - interval '4 days',
       'ResolveIt scheduled maintenance window (seed)', 0.08, 'Cleared after vendor deploy', false)`,
    [incOpen, incInvest, incResolved]
  );

  await pool.query(
    `INSERT INTO incident_notes (incident_id, body, author) VALUES
      ($1, 'Paging MVEND on-call — seed note.', 'seed@koralink.local'),
      ($2, 'Seeing auth header drift on staging; investigating.', 'seed@koralink.local'),
      ($3, 'Marked resolved after smoke tests green.', 'seed@koralink.local')`,
    [incOpen, incInvest, incResolved]
  );

  await pool.end();
  console.log(
    "Seed complete. Login to the dashboard — Event log, Overview, Incidents should show data."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
