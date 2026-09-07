import type { IngestEventInput } from "../schemas/event.js";

export type IngestSource = "sentry" | "direct" | "sdk";

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
  request_body?: string;
  project_id?: string;
  platform?: string;
  os?: string;
  app_version?: string;
  network?: string;
};

export type PersistEventInput = Omit<IngestEventInput, "service"> &
  SentryEventMeta & { service: string };
