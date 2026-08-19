-- Add INTEGRA and RESOLVEIT as product-line rollups alongside DDIN / MVEND / KORALINK.
-- URL mapping (see sentryServiceMap.ts):
--   openapi.gwiza.tech          -> MVEND
--   www.djyh.rw / koralink.org  -> KORALINK
--   core-api.ddin.rw            -> DDIN
--   rw-prod.intelligra.io       -> INTEGRA
--   resolveit.rw                -> RESOLVEIT
-- Safe to re-run: constraints are dropped/recreated defensively.

DO $$
BEGIN
  ALTER TABLE api_events DROP CONSTRAINT IF EXISTS api_events_service_check;
  ALTER TABLE api_events ADD CONSTRAINT api_events_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK', 'INTEGRA', 'RESOLVEIT'));
END
$$;

DO $$
BEGIN
  ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_service_check;
  ALTER TABLE incidents ADD CONSTRAINT incidents_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK', 'INTEGRA', 'RESOLVEIT'));
END
$$;

DO $$
BEGIN
  ALTER TABLE service_health_state DROP CONSTRAINT IF EXISTS service_health_state_service_check;
  ALTER TABLE service_health_state ADD CONSTRAINT service_health_state_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK', 'INTEGRA', 'RESOLVEIT'));
END
$$;

DO $$
BEGIN
  ALTER TABLE upstream_health_state DROP CONSTRAINT IF EXISTS upstream_health_state_service_check;
  ALTER TABLE upstream_health_state ADD CONSTRAINT upstream_health_state_service_check
    CHECK (service IN ('DDIN', 'MVEND', 'KORALINK', 'INTEGRA', 'RESOLVEIT'));
END
$$;

INSERT INTO service_health_state (service) VALUES ('INTEGRA'), ('RESOLVEIT')
ON CONFLICT (service) DO NOTHING;
