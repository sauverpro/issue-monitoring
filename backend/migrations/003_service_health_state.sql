-- Rolling health / recovery state previously kept in Redis — now in Postgres

CREATE TABLE IF NOT EXISTS service_health_state (
  service TEXT PRIMARY KEY CHECK (service IN ('DDIN', 'MVEND')),
  prev_display_status TEXT NOT NULL DEFAULT 'operational'
    CHECK (prev_display_status IN ('operational', 'degraded', 'down')),
  recovery_good_streak INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO service_health_state (service) VALUES ('DDIN'), ('MVEND')
ON CONFLICT (service) DO NOTHING;
