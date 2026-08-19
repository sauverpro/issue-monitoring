-- Active synthetic uptime pings for tracked external APIs.
-- Complements traffic-derived health: detects an upstream going silent
-- (no client traffic at all), which the api_events-based error rate can't see.

CREATE TABLE IF NOT EXISTS synthetic_checks (
  id BIGSERIAL PRIMARY KEY,
  api_id TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  status_code INT,
  latency_ms INT,
  error_message TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_synthetic_checks_api_checked
  ON synthetic_checks (api_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS synthetic_check_state (
  api_id TEXT PRIMARY KEY,
  prev_ok BOOLEAN NOT NULL DEFAULT true,
  fail_streak INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
