import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "../.env") });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

/** Comma-separated list: dashboard + Koralink web origin if the browser POSTs /events directly. */
function parseCorsOrigins(): string | string[] {
  const raw = process.env.CORS_ORIGIN || "http://localhost:5173";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) return "http://localhost:5173";
  if (list.length === 1) return list[0]!;
  return list;
}

/** Optional overrides for dashboard “tracked external APIs” (defaults match .env reference comments). */
const tracked = {
  koralink:
    process.env.TRACKED_KORALINK_URL?.trim() || "https://www.koralink.org",
  gwiza:
    process.env.TRACKED_GWIZA_URL?.trim() || "https://openapi.gwiza.tech",
  ddin:
    process.env.TRACKED_DDIN_URL?.trim() ||
    "https://core-api.ddin.rw/v1/agency",
  tickets:
    process.env.TRACKED_TICKETS_URL?.trim() || "https://resolveit.rw",
};

export const config = {
  port: Number(process.env.PORT) || 3002,
  databaseUrl: requireEnv("DATABASE_URL"),
  ingestApiKey: requireEnv("INGEST_API_KEY"),
  jwtSecret: requireEnv("JWT_SECRET"),
  corsOrigin: parseCorsOrigins(),
  trackedApiUrls: tracked,
  retentionDays: Number(process.env.RETENTION_DAYS) || 30,
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL?.trim() || "",
  dashboardUrl: (process.env.DASHBOARD_URL?.trim() || "").replace(/\/$/, ""),
  sentry: {
    authToken: process.env.SENTRY_AUTH_TOKEN?.trim() || "",
    org: process.env.SENTRY_ORG?.trim() || "ict-chamber",
    project: process.env.SENTRY_PROJECT?.trim() || "market-place",
    baseUrl: (process.env.SENTRY_BASE_URL?.trim() || "https://sentry.io").replace(
      /\/$/,
      ""
    ),
    webhookSecret: process.env.SENTRY_WEBHOOK_SECRET?.trim() || "",
    syncIntervalMs: Number(process.env.SENTRY_SYNC_INTERVAL_MS) || 300_000,
    // Default to only pulling events explicitly tagged by our API instrumentation
    // (tags[type] = api_success/api_failure). Without this filter, the sync pulls
    // every Sentry event for the project (crashes, breadcrumbs, transactions),
    // and untagged rows were previously defaulting to a FAILURE outcome.
    discoverQuery: process.env.SENTRY_DISCOVER_QUERY?.trim() || "has:tags[type]",
  },
};
