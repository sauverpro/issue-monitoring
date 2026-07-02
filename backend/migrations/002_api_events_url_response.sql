-- Full request URL and raw response payload (optional, size-limited at API layer)

ALTER TABLE api_events
  ADD COLUMN IF NOT EXISTS request_url TEXT,
  ADD COLUMN IF NOT EXISTS response_body TEXT;
