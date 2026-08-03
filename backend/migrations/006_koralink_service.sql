-- Add KORALINK as a third product line rollup (alongside DDIN / MVEND).
-- gwiza -> MVEND, ddin -> DDIN, djyh -> KORALINK (see sentryServiceMap.ts).
-- Safe to re-run: constraints are dropped/recreated defensively.

DO $$
BEGIN
  ALTER TABLE api_events DROP CONSTRAINT IF EXISTS api_events_service_check;
  ALTER TABLE api_events ADD CONSTRAINT api_events_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK'));
END
$$;

DO $$
BEGIN
  ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_service_check;
  ALTER TABLE incidents ADD CONSTRAINT incidents_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK'));
END
$$;

DO $$
BEGIN
  ALTER TABLE service_health_state DROP CONSTRAINT IF EXISTS service_health_state_service_check;
  ALTER TABLE service_health_state ADD CONSTRAINT service_health_state_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK'));
END
$$;

DO $$
BEGIN
  ALTER TABLE upstream_health_state DROP CONSTRAINT IF EXISTS upstream_health_state_service_check;
  ALTER TABLE upstream_health_state ADD CONSTRAINT upstream_health_state_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK'));
END
$$;

INSERT INTO service_health_state (service) VALUES ('KORALINK')
ON CONFLICT (service) DO NOTHING;
