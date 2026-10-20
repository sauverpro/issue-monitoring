-- Workplan 9.1.5: payment reliability. Upstreams can be tagged as payment
-- channels so the Payments view tracks the primary rail and any backup
-- (mobile money, an additional provider) side by side.

ALTER TABLE project_upstreams
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE project_upstreams DROP CONSTRAINT IF EXISTS project_upstreams_category_check;
ALTER TABLE project_upstreams ADD CONSTRAINT project_upstreams_category_check
  CHECK (category IN ('payments', 'core', 'digital-services', 'other'));

ALTER TABLE project_upstreams
  ADD COLUMN IF NOT EXISTS channel_role TEXT;
ALTER TABLE project_upstreams DROP CONSTRAINT IF EXISTS project_upstreams_channel_role_check;
ALTER TABLE project_upstreams ADD CONSTRAINT project_upstreams_channel_role_check
  CHECK (channel_role IS NULL OR channel_role IN ('primary', 'backup'));

-- Gwiza / MVEND is the wallet + transfer rail today.
UPDATE project_upstreams
SET category = 'payments', channel_role = 'primary'
WHERE slug = 'MVEND' AND category = 'other';

UPDATE project_upstreams SET category = 'core' WHERE slug = 'KORALINK' AND category = 'other';
UPDATE project_upstreams SET category = 'digital-services' WHERE slug = 'DDIN' AND category = 'other';

-- Incident queries by time window (reports, resolution-time metrics).
CREATE INDEX IF NOT EXISTS idx_incidents_opened ON incidents (opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_events_service_occurred ON api_events (service, occurred_at DESC);
