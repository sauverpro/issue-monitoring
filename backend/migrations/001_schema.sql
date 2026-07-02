-- Koralink API Health Monitor — initial schema

CREATE TABLE IF NOT EXISTS api_events (
  id BIGSERIAL PRIMARY KEY,
  service TEXT NOT NULL CHECK (service IN ('DDIN', 'MVEND')),
  endpoint TEXT NOT NULL,
  status_code INT NOT NULL,
  latency_ms INT NOT NULL,
  error_code TEXT,
  source TEXT NOT NULL CHECK (source IN ('mobile', 'web')),
  session_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_events_occurred_at ON api_events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_events_service_occurred ON api_events (service, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_events_service_endpoint_occurred ON api_events (service, endpoint, occurred_at DESC);

CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY,
  service TEXT NOT NULL CHECK (service IN ('DDIN', 'MVEND')),
  severity TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'investigating', 'resolved')),
  opened_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  title TEXT NOT NULL,
  trigger_error_rate NUMERIC(6, 4),
  resolution_reason TEXT,
  auto_resolved BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_incidents_service_status_opened ON incidents (service, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS incident_notes (
  id BIGSERIAL PRIMARY KEY,
  incident_id UUID NOT NULL REFERENCES incidents (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  author TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_notes_incident ON incident_notes (incident_id, created_at);

CREATE TABLE IF NOT EXISTS dashboard_users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
