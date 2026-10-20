-- Technical reporting loop (workplan 9.2.1): user feedback routed into an
-- enhancement backlog, a release / patch calendar, named feature-adoption
-- funnels, and scheduled report emails.

CREATE TABLE IF NOT EXISTS project_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'patch'
    CHECK (kind IN ('major', 'minor', 'patch', 'hotfix')),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'released', 'cancelled')),
  planned_for DATE,
  released_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ci')),
  commit_sha TEXT,
  created_by UUID REFERENCES console_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_project_releases_project
  ON project_releases (project_id, released_at DESC);

CREATE TABLE IF NOT EXISTS project_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'supervisor'
    CHECK (source IN ('supervisor', 'support_call', 'whatsapp', 'field_visit', 'in_app', 'email', 'other')),
  category TEXT NOT NULL DEFAULT 'request'
    CHECK (category IN ('bug', 'request', 'complaint', 'question', 'praise')),
  feature TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triaged', 'planned', 'in_progress', 'done', 'wont_do')),
  reporter_name TEXT,
  reporter_contact TEXT,
  user_email TEXT,
  user_id TEXT,
  session_id TEXT,
  release_id UUID REFERENCES project_releases (id) ON DELETE SET NULL,
  created_by UUID REFERENCES console_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_project_feedback_project_created
  ON project_feedback (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_feedback_release
  ON project_feedback (release_id) WHERE release_id IS NOT NULL;

-- steps: [{ "label": "...", "type": "screen"|"api", ...matcher }]
CREATE TABLE IF NOT EXISTS project_funnels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  feature TEXT NOT NULL DEFAULT 'general',
  description TEXT NOT NULL DEFAULT '',
  steps JSONB NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES console_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_funnels_project
  ON project_funnels (project_id, position, created_at);

CREATE TABLE IF NOT EXISTS report_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly', 'quarterly')),
  recipients TEXT[] NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  next_run_at TIMESTAMPTZ NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  created_by UUID REFERENCES console_users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, frequency)
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_due
  ON report_schedules (next_run_at) WHERE enabled;
