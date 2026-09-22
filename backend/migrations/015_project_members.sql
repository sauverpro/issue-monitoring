-- Viewers are scoped to specific projects within an organization.
CREATE TABLE IF NOT EXISTS project_members (
  project_id UUID NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES console_users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id);

-- Platform admins operate outside org membership — remove any leftover rows so
-- organizations never list them as members.
DELETE FROM organization_members m
USING console_users u
WHERE m.user_id = u.id AND u.is_platform_admin = true;
