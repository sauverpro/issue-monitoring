-- Role-based access for the dashboard: admin (full access) vs viewer (read-only).
-- Existing users are backfilled to 'admin' so current operators keep full access;
-- new users default to 'viewer' unless explicitly created as admin.

ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS role TEXT;

UPDATE dashboard_users SET role = 'admin' WHERE role IS NULL;

ALTER TABLE dashboard_users ALTER COLUMN role SET DEFAULT 'viewer';
ALTER TABLE dashboard_users ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE dashboard_users ADD CONSTRAINT dashboard_users_role_chk
    CHECK (role IN ('admin', 'viewer'));
EXCEPTION
  WHEN SQLSTATE '42710' THEN NULL;
END
$$;
