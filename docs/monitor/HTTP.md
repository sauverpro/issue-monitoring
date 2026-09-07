# HTTP ingest API (`monitor.v1`)

Any client that can POST JSON can integrate. No npm package is required.

Base URL: `{PUBLIC_INGEST_URL}` (no trailing slash). Paths below are absolute from that origin.

**Mobile / Expo:** `localhost` is the device. Use this machine’s LAN IP (`http://192.168.x.x:3000/ingest/v1`) or Android emulator `http://10.0.2.2:3000/ingest/v1`. See [README — phone / emulator](./README.md#phone-expo-go-emulator--do-not-use-localhost).

## Authentication

Send the project key on every request:

| Header | Example |
|--------|---------|
| `X-Monitor-Key` | `mntr_…` |
| `Authorization` | `Bearer mntr_…` |

Create the key in **organization frontend → project → Settings**. The raw value is shown once.

| Status | Body | Meaning |
|--------|------|---------|
| 401 | `{ "error": "Unauthorized" }` | Missing or unknown key |
| 403 | `{ "error": "Organization suspended" }` | Org suspended |

## `GET /ingest/v1/config`

Discover ingest URL and the current host allowlist (refresh after Settings changes).

```bash
curl -sS -H "X-Monitor-Key: mntr_…" https://YOUR_API_HOST/ingest/v1/config
```

```json
{
  "schema": "monitor.v1",
  "ingestUrl": "https://YOUR_API_HOST/ingest/v1",
  "allowedHosts": ["openapi.gwiza.tech"],
  "upstreams": [
    { "id": "…", "slug": "MVEND", "host": "openapi.gwiza.tech", "label": "" }
  ]
}
```

## `POST /ingest/v1`

Submit a batch of events.

```
Content-Type: application/json
```

| Status | Body | Meaning |
|--------|------|---------|
| 202 | `{ "ok": true, "accepted": n, "dropped": n }` | Valid envelope. `dropped` = API events whose host is not allowlisted |
| 400 | `{ "error": { … Zod flatten } }` | Schema / timestamp validation |
| 401 / 403 | see above | Auth |
| 500 | `{ "error": "Ingest failed" }` | Server error — retry the same batch |

**Limits:** 1–100 events per POST. `response_body` clipped to 131,072 characters. Timestamps must parse as ISO-8601 (`Date.parse`).

Retry on network errors and 5xx. Do not retry 400 (fix the payload). 202 with `dropped` > 0 is not a transport failure — add the host in Settings.

### Envelope

```json
{
  "schema": "monitor.v1",
  "sent_at": "2026-09-01T12:00:00.000Z",
  "session": {
    "id": "stable-session-id",
    "started_at": "2026-09-01T12:00:00.000Z",
    "user_id": "optional",
    "email": "optional@example.com",
    "role": "optional",
    "account_type": "optional"
  },
  "context": {
    "source": "web",
    "platform": "optional",
    "os": "optional",
    "app_version": "optional",
    "network": "optional",
    "screen": "optional"
  },
  "events": []
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `schema` | yes | Literal `monitor.v1` |
| `sent_at` | yes | When the batch left the device |
| `session.id` | yes | 1–128 chars. Reuse for the whole visit |
| `session.started_at` | no | First open of this session |
| `session.user_*` | no | Identify the user; also send an `auth` event |
| `context.source` | no | `web` or `mobile` (default `mobile` if omitted) |
| `events` | yes | Length 1–100 |

### Events (discriminated by `kind`)

Every event:

| Field | Required | Notes |
|-------|----------|--------|
| `kind` | yes | `navigation` · `click` · `lifecycle` · `auth` · `api` · `system` · `screen_view` · `form_start` · `form_submit` · `search` · `filter` · `modal_open` · `modal_close` · `download` · `file_upload` · `purchase_start` · `purchase_complete` · `logout` |
| `occurred_at` | yes | ISO timestamp of the action |
| `action_index` | no | Integer ≥ 0. Use a monotonic counter per session so the timeline sorts correctly (default 0) |

The first six (`navigation`, `click`, `lifecycle`, `auth`, `api`, `system`) are the **core** kinds — send these at minimum. The rest are **behavior/UI** events: optional, but they turn a session timeline into a real product-analytics trail (form funnels, search, purchases, logout) instead of just screens + API calls. All of them accept an optional `screen` field (defaults to the envelope's `context.screen` if omitted).

#### `navigation`

| Field | Required |
|-------|----------|
| `screen` | no (max 256) |
| `from_screen` | no |
| `message` | no (max 512) |

#### `lifecycle`

| Field | Required |
|-------|----------|
| `message` | **yes** (1–512), e.g. `app_start`, `foreground`, `background` |

#### `auth`

| Field | Required |
|-------|----------|
| `message` | no, e.g. `login` |

Also set `session.email` / `user_id` / `role` on the envelope.

#### `click`

| Field | Required |
|-------|----------|
| `label` | **yes** (1–256), e.g. button title |
| `target` | no, e.g. `button`, `Pressable` |
| `screen` | no |

#### `api`

| Field | Required | Notes |
|-------|----------|--------|
| `request_url` | **yes** | Full URL (max 4096). Every host is stored (unknown hosts → service `CUSTOM`) |
| `status_code` | **yes** | 0–599. Use `0` for network failure. Success **and** failure are kept |
| `latency_ms` | **yes** | Integer ≥ 0 |
| `http_method` | no | e.g. `GET` |
| `outcome` | no | `SUCCESS` · `FAILURE` · `OTHER`. If omitted: 2xx → SUCCESS, `0` → OTHER, else FAILURE |
| `failure_reason` | no | max 256 |
| `request_body` | no | JSON or string; passwords/tokens redacted; clipped to 128 KiB |
| `response_body` | no | Same redaction/clipping. Send for **2xx and errors** |
| `current_screen` | no | Screen at request time |

Settings upstream hosts still label rows on **APIs** / Overview. They no longer drop other URLs.

#### `system`

| Field | Required |
|-------|----------|
| `message` | no |

Stored internally as a lifecycle action.

#### `screen_view`

Explicit, meaningful pageview — distinct from `navigation` (a raw URL/route transition). Use this when you want to mark that a screen was actually seen (e.g. after data loaded), not just that routing changed.

| Field | Required |
|-------|----------|
| `screen` | **yes** (max 256) |
| `from_screen` | no |

#### `form_start`

First interaction with a form.

| Field | Required |
|-------|----------|
| `form` | **yes** (max 256), e.g. `checkout`, `create_event` |
| `screen` | no |

#### `form_submit`

| Field | Required |
|-------|----------|
| `form` | **yes** (max 256) |
| `screen` | no |
| `success` | no, boolean |

#### `search`

| Field | Required |
|-------|----------|
| `query` | **yes** (max 512) |
| `screen` | no |
| `results_count` | no, integer ≥ 0 |

#### `filter`

| Field | Required |
|-------|----------|
| `filter` | **yes** (max 256), e.g. `category`, `date_range` |
| `value` | no (max 256) |
| `screen` | no |

#### `modal_open` / `modal_close`

| Field | Required |
|-------|----------|
| `modal` | **yes** (max 256), a stable modal name |
| `screen` | no |

#### `download`

| Field | Required |
|-------|----------|
| `file` | **yes** (max 512), filename or URL |
| `screen` | no |

#### `file_upload`

| Field | Required |
|-------|----------|
| `file` | **yes** (max 512) |
| `screen` | no |
| `size_bytes` | no, integer ≥ 0 |

#### `purchase_start`

| Field | Required |
|-------|----------|
| `item` | no (max 256) |
| `amount` | no, number |
| `currency` | no (max 8), e.g. `USD`, `RWF` |
| `screen` | no |

#### `purchase_complete`

| Field | Required |
|-------|----------|
| `item` | no (max 256) |
| `amount` | no, number |
| `currency` | no (max 8) |
| `order_id` | no (max 256) |
| `screen` | no |

#### `logout`

| Field | Required |
|-------|----------|
| `screen` | no |

### Minimal accepted batch

```json
{
  "schema": "monitor.v1",
  "sent_at": "2026-09-01T00:00:00.000Z",
  "session": { "id": "sess-1" },
  "context": { "source": "mobile" },
  "events": [
    {
      "kind": "navigation",
      "occurred_at": "2026-09-01T00:00:01.000Z",
      "action_index": 0,
      "screen": "/wallet"
    },
    {
      "kind": "api",
      "occurred_at": "2026-09-01T00:00:02.000Z",
      "action_index": 1,
      "request_url": "https://openapi.gwiza.tech/transfer",
      "http_method": "POST",
      "status_code": 401,
      "latency_ms": 654
    }
  ]
}
```

## CORS

The API uses `CORS_ORIGIN` (comma-separated). Browser pages that `fetch` ingest must list their origin there. Native and server clients ignore CORS.

## What the organization app reads

| You send | Organization app |
|----------|---------|
| `session.id` + `user_id` / email | **Sessions** list (search by email or user id) |
| `api` events | **Overview**, **APIs**, session timeline with request/response bodies |
| `navigation` / `screen_view` / `click` / `lifecycle` / `auth` / `logout` | **Session detail** full action trail |
| `form_start` / `form_submit` / `search` / `filter` / `modal_open` / `modal_close` / `download` / `file_upload` / `purchase_start` / `purchase_complete` | Same session timeline, plus **User Behavior** (most-visited screens, common journeys) and **Funnels** |

Session list `totalActions` counts API calls **and** every journey/behavior event kind above.

## Do not use the legacy ops ingest

`POST /api/events` and `POST /events` use a different key (`INGEST_API_KEY`) and do **not** attach `project_id`. They will not appear in the organization app.

## Next

[Integration journey (setup → cut over)](./README.md)
