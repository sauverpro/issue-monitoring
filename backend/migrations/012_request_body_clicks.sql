-- Request bodies on API rows; any upstream slug (not only the five ops services);
-- click events on the journey timeline.

ALTER TABLE api_events ADD COLUMN IF NOT EXISTS request_body TEXT;

ALTER TABLE api_events DROP CONSTRAINT IF EXISTS api_events_service_check;

ALTER TABLE session_actions DROP CONSTRAINT IF EXISTS session_actions_kind_check;
ALTER TABLE session_actions ADD CONSTRAINT session_actions_kind_check
  CHECK (kind IN ('navigation', 'lifecycle', 'auth', 'click'));
