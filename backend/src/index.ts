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
import { startSentrySyncScheduler } from "./services/sentrySync.js";

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

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

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

startRecoveryScheduler(pool);
startSentrySyncScheduler(pool);

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

app.listen(config.port, () => {
  console.log(`Koralink monitor API listening on port ${config.port}`);
});
