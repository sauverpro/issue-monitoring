# Session Investigation API

All routes require JWT (`Authorization: Bearer <token>`). The frontend calls these via `/api/*` (Vite proxy strips the prefix).

Sentry credentials stay server-side (`SENTRY_AUTH_TOKEN`). Responses are cached in-process for 5 minutes using Redis-compatible keys (`session:{id}`, `session:list:*`).

## Sessions

### `GET /api/sessions`

List sessions grouped from `user_sessions` (ingested Sentry data).

| Query | Description |
|-------|-------------|
| `page` | Page number (default 1) |
| `limit` | Page size (default 20, max 100) |
| `email` | Filter by user email (ILIKE) |
| `role` | Filter by role |
| `accountType` | Filter by account type |
| `status` | `all`, `failures`, or `success` |
| `startDate` | ISO date — sessions started after |
| `endDate` | ISO date — sessions ended before |
| `sessionId` | Exact session ID |

**Response:** JSON array of session list items.

```json
[
  {
    "sessionId": "sess_1782102707258_8csjx4",
    "userEmail": "user@example.com",
    "role": "DCC",
    "accountType": "Agent",
    "totalActions": 23,
    "failures": 2,
    "startedAt": "2026-06-22T04:31:00.000Z",
    "lastActivity": "2026-06-22T04:35:00.000Z"
  }
]
```

### `GET /api/sessions/:sessionId/actions`

Fetches actions for a session. Tries Sentry Discover API first (`tags[session_id]:{sessionId}`), falls back to Postgres `api_events`. Actions are sorted by `action_index` locally.

**Response:**

```json
{
  "sessionId": "sess_…",
  "user": { "id": "…", "email": "…", "role": "DCC", "accountType": "Agent" },
  "summary": {
    "totalActions": 15,
    "successfulActions": 12,
    "failedActions": 3,
    "apiCalls": 15,
    "errorRate": 0.2,
    "startedAt": "…",
    "endedAt": "…"
  },
  "actions": [ … ]
}
```

### `GET /api/sessions/:sessionId/failures`

Returns failure subset for a session.

```json
{
  "sessionId": "sess_…",
  "failures": [
    {
      "endpoint": "https://…",
      "service": "marketplace",
      "failureReason": "Parsing Error",
      "httpStatus": "PARSING_ERROR",
      "timestamp": "…",
      "actionIndex": 3
    }
  ]
}
```

### `GET /api/sessions/analytics?days=7`

Aggregated metrics from Postgres for the dashboard charts.

## Issues (Sentry)

### `GET /api/issues?page=1&limit=20`

Lists unresolved Sentry issues for the configured project.

### `GET /api/issues/:issueId`

Returns issue detail plus session correlation:

```json
{
  "id": "12345",
  "title": "…",
  "relatedSessionId": "sess_…",
  "sessionActionsUrl": "/monitoring/sessions/sess_…"
}
```

`relatedSessionId` is extracted from the latest Discover event tagged with `session_id` for that issue.

## Rate limiting

Sentry proxy routes are limited to 30 requests/minute per client IP.

## Legacy routes

These remain for backward compatibility:

- `GET /sessions` — window-based list
- `GET /sessions/:sessionId` — `{ session, timeline }` from Postgres

## Environment

```env
SENTRY_AUTH_TOKEN=
SENTRY_ORG=ict-chamber
SENTRY_PROJECT=market-place
```
