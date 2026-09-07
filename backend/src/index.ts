import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { eventsRouter } from "./routes/events.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { metricsRouter } from "./routes/metrics.js";
import { dashboardEventsRouter } from "./routes/dashboardEvents.js";
import { incidentsRouter } from "./routes/incidents.js";
import { streamRouter } from "./routes/stream.js";
import { startRecoveryScheduler } from "./services/recovery.js";
import { sentryWebhookRouter } from "./routes/sentryWebhook.js";
import { sessionsRouter } from "./routes/sessions.js";
import { endpointMetricsRouter } from "./routes/endpointMetrics.js";
import { apiSessionsRouter } from "./routes/apiSessions.js";
import { issuesRouter } from "./routes/issues.js";
import { powerbiRouter } from "./routes/powerbi.js";
import { sentrySyncRouter } from "./routes/sentrySyncStatus.js";
import { startSentrySyncScheduler } from "./services/sentrySync.js";
import { usersRouter } from "./routes/users.js";
import { uptimeRouter } from "./routes/uptime.js";
import { statusRouter } from "./routes/status.js";
import { startRetentionScheduler } from "./services/retention.js";
import { startSyntheticPingScheduler } from "./services/syntheticPing.js";
import { consoleAuthRouter } from "./routes/consoleAuth.js";
import { consoleOrgsRouter } from "./routes/consoleOrgs.js";
import { consoleProjectsRouter } from "./routes/consoleProjects.js";
import { consoleAdminRouter } from "./routes/consoleAdmin.js";
import { monitorIngestRouter } from "./routes/monitorIngest.js";
import { sdkPackagesRouter } from "./routes/sdkPackages.js";
import { deviceOrigins } from "./services/lanHost.js";

const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);
app.use(
  cors({
    origin: config.corsOrigin,
    credentials: true,
  })
);
app.use(sentryWebhookRouter());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use(sdkPackagesRouter());

app.use(eventsRouter());
app.use(authRouter(pool));
app.use(healthRouter(pool));
app.use(metricsRouter(pool));
app.use(dashboardEventsRouter(pool));
app.use(incidentsRouter(pool));
app.use(streamRouter());
app.use(sessionsRouter(pool));
app.use(endpointMetricsRouter(pool));
app.use(apiSessionsRouter(pool));
app.use(issuesRouter(pool));
app.use(powerbiRouter(pool));
app.use(sentrySyncRouter(pool));
app.use(usersRouter(pool));
app.use(uptimeRouter(pool));
app.use(statusRouter(pool));
app.use(consoleAuthRouter(pool));
app.use(consoleOrgsRouter(pool));
app.use(consoleProjectsRouter(pool));
app.use(consoleAdminRouter(pool));
app.use(monitorIngestRouter(pool));

startRecoveryScheduler(pool);
startSentrySyncScheduler(pool);
startRetentionScheduler(pool);
startSyntheticPingScheduler(pool);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    console.error(err);
    if (res.headersSent) {
      next(err);
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(config.port, "0.0.0.0", () => {
  const { lanOrigin, androidEmulatorOrigin } = deviceOrigins(config.publicIngestUrl, config.port);
  console.log(`Koralink monitor API listening on 0.0.0.0:${config.port}`);
  console.log(`  local             ${config.publicIngestUrl}/ingest/v1`);
  if (lanOrigin) {
    console.log(`  phone / Expo Go   ${lanOrigin}/ingest/v1`);
  }
  console.log(`  Android emulator  ${androidEmulatorOrigin}/ingest/v1`);
});
