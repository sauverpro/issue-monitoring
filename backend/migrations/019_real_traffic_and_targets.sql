-- Mock / sandbox / staging endpoints are test traffic that always fails; they must
-- not count in availability, dashboards, reports or incident evaluation. Raw rows are
-- kept (per-agent timelines still show them); analytics read this view instead.
CREATE OR REPLACE VIEW api_events_real AS
  SELECT * FROM api_events
  WHERE COALESCE(endpoint, request_url, '') !~* '(mock|sandbox|staging)';

-- Reliability targets per project, so a pilot app can be judged against
-- stage-appropriate goals (shown alongside the long-term goal), and raised later.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS reliability_targets JSONB NOT NULL DEFAULT
    '{"phase": "Pilot", "overall": 0.95, "core": 0.97, "thirdParty": 0.90, "longTerm": 0.995, "coreServices": ["KORALINK"]}'::jsonb;
