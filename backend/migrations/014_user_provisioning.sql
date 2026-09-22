-- Accounts are provisioned by admins (platform admin seeds org admins, org admins
-- add viewers), so a freshly created user logs in with a temporary password and
-- must replace it before reaching the dashboard.

ALTER TABLE console_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE console_users
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES console_users (id) ON DELETE SET NULL;
