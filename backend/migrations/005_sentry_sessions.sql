-- Sentry ingest metadata + session rollups

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE api_events ADD COLUMN IF NOT EXISTS sentry_event_id TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS app_service TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS action_index INT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS user_email TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS user_role TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS account_type TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS sentry_type TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS ingest_source TEXT NOT NULL DEFAULT 'direct';

UPDATE api_events SET ingest_source = 'direct' WHERE ingest_source IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_events_sentry_event_id
  ON api_events (sentry_event_id) WHERE sentry_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_events_session_action
  ON api_events (session_id, action_index) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_events_session_occurred
  ON api_events (session_id, occurred_at DESC) WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_events_request_url_occurred
  ON api_events (request_url, occurred_at DESC) WHERE request_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_events_user_occurred
  ON api_events (user_id, occurred_at DESC) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_events_app_service_occurred
  ON api_events (app_service, occurred_at DESC) WHERE app_service IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_sessions (
  session_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  last_action_index INT,
  user_id TEXT,
  user_email TEXT,
  role TEXT,
  account_type TEXT,
  total_events INT NOT NULL DEFAULT 0,
  failure_events INT NOT NULL DEFAULT 0,
  distinct_endpoints INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_ended_at ON user_sessions (ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_failures ON user_sessions (failure_events DESC);

CREATE TABLE IF NOT EXISTS sentry_sync_state (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sentry_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
