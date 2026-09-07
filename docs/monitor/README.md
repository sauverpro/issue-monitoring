# Monitor — integrate an app until this system manages it

Self-hosted telemetry for **user journeys**, **tracked upstream APIs**, and **session / device context**. This is not a crash reporter: only hosts you add on the project are stored.

**Preferred integration is HTTP.** Call two URLs from any language. The npm SDK is optional and wraps the same contract.

| Doc | When to use it |
|-----|----------------|
| This page | Full path: superadmin creates the org → organization app setup → first event → journeys → dual-run → cut over |
| [HTTP ingest API](./HTTP.md) | Envelope fields, status codes, batching, host allowlist |
| [SDK packages](./PACKAGES.md) | Optional tarball / GitHub Packages install |

```
App (any stack)
   │  GET  /ingest/v1/config     allowed hosts
   │  POST /ingest/v1            monitor.v1 envelope
   ▼
Monitor API  ──►  Organization app: Overview · Sessions · APIs
```

---

## Phase 1 — Create the project in the organization app

1. A **platform admin** signs in at `/login` on the same frontend (`http://localhost:5173`) and opens **Platform → Organizations** (`/platform`), creates an **organization**, then invites an owner email (that person must already be registered).
2. The owner signs in at `/login` (same app — not ops at `/ops/login`). Create a **project** (`web` or `react-native` — this only sets snippet defaults).
3. **Settings → Allowed upstream hosts.** Add each API host the app calls (host only, no path), e.g. `openapi.gwiza.tech`. Until at least one host exists, every `api` event is dropped.
4. **Settings → Create key.** Copy the `mntr_…` value immediately. It is shown once.
5. Open **Integration**. You get:
   - `POST {PUBLIC_INGEST_URL}/ingest/v1`
   - `GET  {PUBLIC_INGEST_URL}/ingest/v1/config`

`PUBLIC_INGEST_URL` is the public API origin (local default is `http://localhost:3000` if `PORT=3000`). Nginx should proxy `/ingest` the same way as `/sdk`.

### Phone, Expo Go, emulator — do not use `localhost`

On a device, `http://localhost:3000` is the **phone**, so you get Axios `Network Error`. Use this PC’s LAN IP on the same Wi‑Fi (shown on **Integration** and in the API boot log):

| Client | Ingest URL |
|--------|------------|
| curl / browser on this PC | `http://localhost:3000/ingest/v1` |
| Physical phone / Expo Go | `http://YOUR_LAN_IP:3000/ingest/v1` (e.g. `http://192.168.1.22:3000/ingest/v1`) |
| Android emulator | `http://10.0.2.2:3000/ingest/v1` |
| iOS Simulator | `http://localhost:3000/ingest/v1` usually works |

The API listens on `0.0.0.0` so LAN clients can connect. Also:

1. Phone and PC on the **same Wi‑Fi** (not guest/VPN isolation).
2. Windows Firewall: allow Node.js / TCP **3000**.
3. Expo / RN **cleartext HTTP** (Android blocks `http://` by default):

```json
{
  "expo": {
    "android": { "usesCleartextTraffic": true }
  }
}
```

iOS: allow local networking, or use HTTPS in production.

`Route "./sentry.config.ts" is missing the required default export` is Expo Router treating that file as a screen. Move `sentry.config.ts` **out of** the `app/` directory (project root is fine). It is unrelated to ingest.

---

## Phase 2 — Prove ingest with HTTP (no package)

Replace the key and host, then run from any machine that can reach the API:

```bash
export INGEST="http://localhost:3000/ingest/v1"
export KEY="mntr_YOUR_PROJECT_KEY"

curl -sS -H "X-Monitor-Key: $KEY" "$INGEST/config"

curl -sS -X POST "$INGEST" \
  -H "Content-Type: application/json" \
  -H "X-Monitor-Key: $KEY" \
  -d '{
    "schema": "monitor.v1",
    "sent_at": "2026-09-01T12:00:00.000Z",
    "session": { "id": "smoke-1", "email": "qa@example.com" },
    "context": { "source": "web", "platform": "curl" },
    "events": [
      {
        "kind": "navigation",
        "occurred_at": "2026-09-01T12:00:01.000Z",
        "action_index": 0,
        "screen": "/smoke"
      },
      {
        "kind": "api",
        "occurred_at": "2026-09-01T12:00:02.000Z",
        "action_index": 1,
        "request_url": "https://YOUR_ALLOWED_HOST/health",
        "http_method": "GET",
        "status_code": 200,
        "latency_ms": 42
      }
    ]
  }'
```

Expect `202` with `{ "ok": true, "accepted": 2, "dropped": 0 }`. If `dropped` is `1`, the API host is not on the project allowlist.

**Check the organization app**

| Page | You should see |
|------|----------------|
| **Overview** | Sessions ≥ 1, API calls ≥ 1, upstream row for that host |
| **Sessions** | Session `smoke-1` (list `totalActions` counts API events) |
| **Session detail** | Navigation + API in timeline order (`action_index`) |
| **APIs** | Counts grouped by upstream slug |

Auth: `X-Monitor-Key: mntr_…` or `Authorization: Bearer mntr_…`.

Copy-paste **curl / fetch / axios** live on the project **Integration** page. Field-level contract: [HTTP.md](./HTTP.md).

---

## Phase 3 — Instrument the real app

Keep one **session id** for the whole visit (UUID at cold start). Increment **`action_index`** on every event (0, 1, 2, …). Batch up to **100** events per POST.

Send at least the **core** kinds:

| When | `kind` | Why |
|------|--------|-----|
| Screen / route change | `navigation` | Screen views on the session timeline |
| Button / tap | `click` | Friction and dead-end UI |
| Foreground / background / start | `lifecycle` | Session completeness |
| Login / identify user | `auth` + `session.user_id` / `email` / `role` | Find every session for that user |
| **Every** HTTP call (2xx and errors) | `api` | Request **and** response bodies, latency, status |
| Rare diagnostics | `system` | Extra breadcrumb (stored as lifecycle) |

Include `request_body` and `response_body` on API events (success and failure). Passwords, pins, tokens, and similar keys are redacted server-side. Search **Sessions** by email or user id, then open the timeline.

**Optional — behavior events.** Send these too if you want real product-analytics, not just screens + API calls: `screen_view` (explicit pageview), `form_start` / `form_submit`, `search`, `filter`, `modal_open` / `modal_close`, `download`, `file_upload`, `purchase_start` / `purchase_complete`, `logout`. Full field reference per kind: [HTTP.md](./HTTP.md#events-discriminated-by-kind). The React Native and web SDKs expose a dedicated `captureX()` method for each of these (`captureSearch`, `capturePurchaseComplete`, …) — exact call signatures and copy-paste examples are on the project's **Integration** page (SDK · web / SDK · RN tabs). Installing the packages: [PACKAGES.md](./PACKAGES.md). `form_start`/`form_submit`/`file_upload`/`download` are auto-captured by the web SDK; the rest are manual calls on both SDKs.

**Browser `fetch`:** add the web app origin to API `CORS_ORIGIN`. React Native, servers, and curl do not need CORS.

**Maintainable pattern:** one small helper (`postMonitor` + `monitoredFetch` / axios interceptor, plus `trackScreen` / `trackClick` / `identify`). The Integration page tabs include this.

---

## Phase 4 — Dual-run with Sentry (optional)

If the app already reports to Sentry:

1. Leave Sentry in place.
2. Ship HTTP ingest for journeys + allowed-host APIs.
3. Compare Monitor **Sessions** timelines with production behavior.
4. Ops Sentry sync (`SENTRY_AUTH_TOKEN`) can keep filling the **Koralink ops** dashboard (`/ops`). It is separate from organization project data.

Monitor does not replace crash grouping or stack traces. Keep a crash tool until you explicitly decide otherwise.

---

## Phase 5 — App is fully managed here

The app is managed by Monitor when all of these are true:

- [ ] Every production upstream host is listed in Settings
- [ ] Every user session has a stable `session.id` and `action_index`
- [ ] Identified users send `auth` + session email/id
- [ ] Navigations and lifecycle fire without gaps
- [ ] Allowed-host HTTP shows on **APIs** with plausible success/failure/latency
- [ ] Overview matches what support sees in the field
- [ ] Ingest keys live in app config / secrets, not in git
- [ ] Sentry (or other) journey/API duplication is removed from the app
- [ ] If you no longer need ops Sentry sync, unset `SENTRY_AUTH_TOKEN` and restart the API

After cutover, operate in the organization app only: rotate keys, add/remove hosts, watch Overview and session timelines.

---

## Optional — npm SDK

Use only if you want automatic `fetch` / navigation hooks. Same URLs and key. See [PACKAGES.md](./PACKAGES.md).

---

## Production bootstrap (ICT Chamber → Marketplace)

On the production DB (after migrations), with `DATABASE_URL` and admin credentials in `.env`:

```bash
npm run db:seed:production
```

This upserts ops + platform admins, ensures the **ICT Chamber** org and **Marketplace** project (upstreams + ingest keys if missing), and **assigns all existing** `user_sessions` / `session_actions` / `api_events` to Marketplace. New ingest keys are printed once when created.

---

## What is stored vs dropped

**Stored:** screen views (`navigation`, `screen_view`), button clicks, lifecycle, auth, logout, and the behavior events (form start/submit, search, filter, modal open/close, download, file upload, purchase start/complete); **all** HTTP calls in the app (success and failure) with redacted request/response bodies.

**Dropped:** duplicate journey rows (same session/time/kind/message); crashes / stack traces. Settings hosts no longer drop other APIs — they only label Overview / APIs.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `401 Unauthorized` | Missing/wrong key, or revoked key |
| `403 Organization suspended` | Platform admin suspended the org |
| `400` + Zod flatten | Envelope failed `monitor.v1` (timestamps, missing `schema`, empty `events`) |
| `202` with `dropped` > 0 | Duplicate journey event, or validation skipped a row |
| Overview still empty | Events never accepted, or looking at a different project |
| Browser CORS error | Add the app origin to `CORS_ORIGIN` |
| `EALLOWREMOTE` on npm SDK install | npm 12+ blocks tarball URLs — see [PACKAGES.md](./PACKAGES.md) |
