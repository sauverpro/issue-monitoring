-- Multi-tenant monitor console: orgs, projects, hashed ingest keys,
-- and project_id on telemetry. Existing Koralink rows keep project_id NULL.

CREATE TABLE IF NOT EXISTS console_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  is_platform_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES console_users (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON organization_members (user_id);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('react-native', 'web')),
  allowed_hosts TEXT[] NOT NULL DEFAULT '{}',
  retention_days INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_org ON projects (organization_id);

CREATE TABLE IF NOT EXISTS project_upstreams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  host TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  UNIQUE (project_id, slug),
  UNIQUE (project_id, host)
);

CREATE INDEX IF NOT EXISTS idx_project_upstreams_project
  ON project_upstreams (project_id);

CREATE TABLE IF NOT EXISTS project_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_project_api_keys_project
  ON project_api_keys (project_id)
  WHERE revoked_at IS NULL;

ALTER TABLE api_events ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects (id);
ALTER TABLE session_actions ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects (id);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects (id);
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS os TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS network TEXT;

CREATE INDEX IF NOT EXISTS idx_api_events_project_occurred
  ON api_events (project_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_events_project_session
  ON api_events (project_id, session_id);
CREATE INDEX IF NOT EXISTS idx_session_actions_project_session
  ON session_actions (project_id, session_id, occurred_at ASC);
CREATE INDEX IF NOT EXISTS idx_user_sessions_project_ended
  ON user_sessions (project_id, ended_at DESC);

-- Per-project upstream slugs are not limited to the five Koralink services.
ALTER TABLE api_events DROP CONSTRAINT IF EXISTS api_events_service_check;
ALTER TABLE api_events ADD CONSTRAINT api_events_service_check
  CHECK (char_length(btrim(service)) BETWEEN 1 AND 64);
