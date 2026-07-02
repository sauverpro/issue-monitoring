-- Per-integrated-API identity + explicit call outcome (SUCCESS / FAILURE / OTHER).
-- OTHER = no usable HTTP response (e.g. network down, timeout before status line).
-- Safe to re-run: constraints are added only if missing.

ALTER TABLE api_events ADD COLUMN IF NOT EXISTS upstream_key TEXT;
ALTER TABLE api_events ADD COLUMN IF NOT EXISTS outcome TEXT;

UPDATE api_events SET upstream_key = COALESCE(
  NULLIF(
    lower(regexp_replace(regexp_replace(
      trim(both '/' from split_part(COALESCE(endpoint, ''), '?', 1)),
      '^/+', '', 'g'),
      '[^a-z0-9]+', '_', 'g')),
    ''),
  'unknown'
)
WHERE upstream_key IS NULL;

UPDATE api_events SET outcome = CASE
  WHEN status_code = 0 THEN 'OTHER'
  WHEN status_code >= 200 AND status_code < 300 THEN 'SUCCESS'
  ELSE 'FAILURE'
END
WHERE outcome IS NULL;

ALTER TABLE api_events ALTER COLUMN upstream_key SET NOT NULL;
ALTER TABLE api_events ALTER COLUMN outcome SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE api_events ADD CONSTRAINT api_events_upstream_key_len
    CHECK (char_length(upstream_key) BETWEEN 1 AND 128);
EXCEPTION
  WHEN SQLSTATE '42710' THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE api_events ADD CONSTRAINT api_events_outcome_chk
    CHECK (outcome IN ('SUCCESS', 'FAILURE', 'OTHER'));
EXCEPTION
  WHEN SQLSTATE '42710' THEN NULL;
END
$$;

CREATE INDEX IF NOT EXISTS idx_api_events_svc_up_occurred
  ON api_events (service, upstream_key, occurred_at DESC);

CREATE TABLE IF NOT EXISTS upstream_health_state (
  service TEXT NOT NULL CHECK (service IN ('DDIN', 'MVEND')),
  upstream_key TEXT NOT NULL,
  prev_display_status TEXT NOT NULL DEFAULT 'operational'
    CHECK (prev_display_status IN ('operational', 'degraded', 'down')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (service, upstream_key)
);

INSERT INTO upstream_health_state (service, upstream_key, prev_display_status, updated_at)
SELECT DISTINCT service, upstream_key, 'operational', now()
FROM api_events
ON CONFLICT (service, upstream_key) DO NOTHING;
