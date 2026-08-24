-- User-journey rows (navigation / lifecycle / auth) live here so they do not
-- inflate API error rates. API calls stay on api_events.
-- Also store the screen and HTTP method that the mobile span carries.

ALTER TABLE api_events ADD COLUMN IF NOT EXISTS current_screen TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS http_method TEXT;

CREATE TABLE IF NOT EXISTS session_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  sentry_event_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('navigation', 'lifecycle', 'auth')),
  message TEXT NOT NULL DEFAULT '',
  screen TEXT,
  from_screen TEXT,
  payload JSONB,
  UNIQUE (session_id, occurred_at, kind, message)
);

CREATE INDEX IF NOT EXISTS idx_session_actions_session_occurred
  ON session_actions (session_id, occurred_at ASC);
