-- Live dashboard: newest-first project feeds, per-agent history, event lookup.
CREATE INDEX IF NOT EXISTS idx_session_actions_project_occurred
  ON session_actions (project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_actions_sentry_event_id
  ON session_actions (sentry_event_id) WHERE sentry_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_api_events_project_userkey_occurred
  ON api_events (project_id, (COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''), session_id)), occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_project_userkey
  ON user_sessions (project_id, (COALESCE(NULLIF(TRIM(user_id), ''), NULLIF(TRIM(user_email), ''), session_id)));
