# System Workflow — Koralink API Health Monitor

End-to-end description of how telemetry flows through the monitor, how health is evaluated, and how operators interact with the dashboard.

---

## Architecture Overview

```
┌─────────────────┐     POST /events        ┌──────────────────────────────────────────┐
│ Koralink mobile │ ───────────────────────▶│                                          │
│ app (instrumented)                         │         Express API (backend)            │
└─────────────────┘                           │                                          │
                                              │  ┌─────────────┐   ┌─────────────────┐  │
┌─────────────────┐     Sentry webhook      │  │ processEvent│──▶│ PostgreSQL      │  │
│ Sentry          │ ───────────────────────▶│  │ (persist +  │   │ api_events      │  │
│ (errors/events) │                         │  │  evaluate)  │   │ incidents       │  │
└─────────────────┘                         │  └──────┬──────┘   │ user_sessions   │  │
                                              │         │         │ health_state    │  │
┌─────────────────┐     Discover sync       │         │ SSE     └────────▲────────┘  │
│ Sentry Discover │ ───────────────────────▶│         └──────────────────┘            │
│ (scheduled)     │                         │                                          │
└─────────────────┘                         │  Background schedulers:                  │
                                              │  • Recovery (5 min)                      │
┌─────────────────┐     GET /health         │  • Synthetic ping (2 min)                │
│ Synthetic pings │ ◀───────────────────────│  • Retention (daily)                     │
│ (tracked APIs)  │                         │  • Sentry sync (interval)                │
└─────────────────┘                         └──────────────────┬───────────────────────┘
                                                                 │
                    ┌────────────────────────────────────────────┼────────────────────┐
                    │                                            │                    │
                    ▼                                            ▼                    ▼
           ┌────────────────┐                          ┌──────────────┐    ┌──────────────┐
           │ React dashboard│                          │ Public status│    │ Slack alerts │
           │ (JWT auth)     │                          │ /status page │    │ (optional)   │
           └────────────────┘                          └──────────────┘    └──────────────┘
```

**Stack**: React (Vite) frontend · Express (TypeScript) backend · PostgreSQL · PM2 on VPS · optional Vercel for frontend.

---

## 1. Telemetry Ingestion

Three paths feed the same `persistAndProcessEvent` pipeline:

| Source | Route / trigger | Notes |
|--------|-----------------|-------|
| **Direct instrumentation** | `POST /events` | Mobile app sends each API call with service, endpoint, outcome, latency, session context |
| **Sentry webhook** | `POST /sentry/webhook` | Real-time error events from Sentry projects |
| **Sentry Discover sync** | Scheduler (`sentrySync.ts`) | Polls Sentry Discover API for events not yet ingested; deduplicates via `sentry_event_id` |

Each event is stored in `api_events` and linked to a `user_sessions` row when `session_id` is present.

---

## 2. Health Evaluation (per event)

After insert, the backend recalculates rolling health for the affected **service** (MVEND, KORALINK, DDIN, INTEGRA, RESOLVEIT) and **upstream endpoint**:

1. **Sliding window** — error rate over the last 5 minutes (`slidingWindow.ts`).
2. **Status mapping**:
   - **operational** — error rate &lt; 5%
   - **degraded** — error rate ≥ 5%
   - **down** — error rate ≥ 60%
3. **State change detection** — compares new status to `service_health_state.prev_display_status`.
4. **Incident lifecycle** — on transition into degraded/down:
   - Opens a new incident (or updates severity) via `incidents.ts`
   - Sends Slack notification (if configured)
   - Broadcasts SSE event to connected dashboards
5. **Dashboard metrics** — aggregated counts, sparklines, and P50/P95 latencies are served from `/metrics/dashboard`.

---

## 3. Background Schedulers

Started in `backend/src/index.ts` on boot:

| Scheduler | Interval | Purpose |
|-----------|----------|---------|
| **Recovery** | 5 min | If error rate stays below 5% for **2 consecutive ticks**, auto-resolves open incidents and notifies Slack |
| **Synthetic ping** | 2 min | Active GET requests to configured upstream base URLs; marks APIs unreachable after 2 consecutive failures |
| **Retention** | 24 h | Deletes `api_events` older than `RETENTION_DAYS` (batched, configurable) |
| **Sentry sync** | Configurable | Backfills events from Sentry Discover when webhook delivery is missed |

---

## 4. Uptime & Public Status

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/status` | None | Public JSON snapshot: overall status, per-service health, tracked APIs, recent incidents, monthly uptime |
| `GET /api/uptime/*` | JWT | Detailed uptime/SLA views for authenticated operators |

The frontend **Status** page (`/status`) renders this data for stakeholders without login.

---

## 5. Dashboard Workflow (operator)

Typical investigation path:

```
Overview (/) ──▶ detect degraded service or open incident
      │
      ├──▶ Incidents ──▶ Incident detail ──▶ notes, resolution
      │
      ├──▶ Events ──▶ filter by outcome/service ──▶ raw call log
      │
      ├──▶ Endpoints ──▶ per-URL metrics and sparklines
      │
      ├──▶ Monitoring / Sessions ──▶ replay one user's action sequence
      │
      ├──▶ Monitoring / Issues ──▶ Sentry-linked unresolved errors
      │
      └──▶ Monitoring / Uptime ──▶ monthly SLA percentages
```

**Realtime updates**: the Overview page subscribes to Server-Sent Events (`/stream`) so metric cards refresh when new events or incident changes occur.

---

## 6. Authentication & Roles

| Role | Access |
|------|--------|
| **viewer** | All dashboard pages except user management |
| **admin** | Full access including `/settings/users` |

Login issues a JWT (`POST /auth/login`). Protected API routes validate the token via middleware.

---

## 7. Monitored Services

| Code | API | Base URL |
|------|-----|----------|
| **MVEND** | Gwiza digital payments | https://openapi.gwiza.tech/ |
| **KORALINK** | Marketplace core API | https://www.djyh.rw/api/v1/ |
| **DDIN** | Digital services API | https://core-api.ddin.rw/v1/ |
| **INTEGRA** | Intelligra API | https://rw-prod.intelligra.io/intelligrapi/ |
| **RESOLVEIT** | Ticket management ([ResolveIt](https://resolveit.rw)) | https://resolveit.rw |

Sentry events are classified onto these services from the request URL host first, then from `tags[service]`. Each service has independent health state, incidents, and uptime tracking. **Tracked upstream APIs** (discovered from client requests or configured definitions) are evaluated separately and shown on the Overview and Endpoints pages.

---

## 8. Local Development

From the repo root:

```bash
# Terminal 1 — API
npm run dev:backend

# Terminal 2 — Dashboard
npm run dev:frontend

# Database (first time)
npm run db:migrate
npm run db:seed:dev
```

Frontend defaults to `http://localhost:5173`; backend to port configured in `backend/.env` (typically 3002). Set `CORS_ORIGIN` to match the frontend URL.

---

## Related Docs

- [Deployment Guide](./DEPLOYMENT.md) — VPS setup, PM2, Nginx, CI/CD
- [Session Investigation API](./session-investigation-api.md) — JWT-protected session/issue endpoints
