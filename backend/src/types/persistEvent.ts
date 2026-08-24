import type { IngestEventInput } from "../schemas/event.js";

export type IngestSource = "sentry" | "direct";

export type SentryEventMeta = {
  sentry_event_id?: string;
  app_service?: string;
  action_index?: number;
  user_id?: string;
  user_email?: string;
  user_role?: string;
  account_type?: string;
  sentry_type?: string;
  failure_reason?: string;
  ingest_source?: IngestSource;
  http_method?: string;
  current_screen?: string;
};

export type PersistEventInput = IngestEventInput & SentryEventMeta;
