export type MonitorUser = {
  id?: string;
  email?: string;
  role?: string;
  accountType?: string;
};

export type MonitorContext = {
  source?: "mobile" | "web";
  platform?: string;
  os?: string;
  app_version?: string;
  network?: string;
  screen?: string;
};

export type MonitorInit = {
  ingestUrl: string;
  apiKey: string;
  allowedHosts?: string[];
  flushIntervalMs?: number;
  maxQueue?: number;
  source?: "mobile" | "web";
  fetchImpl?: typeof fetch;
};

export type EnvelopeEvent =
  | {
      kind: "navigation";
      occurred_at: string;
      action_index: number;
      screen?: string;
      from_screen?: string;
      message?: string;
    }
  | {
      kind: "lifecycle";
      occurred_at: string;
      action_index: number;
      message: string;
    }
  | {
      kind: "auth";
      occurred_at: string;
      action_index: number;
      message?: string;
    }
  | {
      kind: "api";
      occurred_at: string;
      action_index: number;
      request_url: string;
      http_method?: string;
      status_code: number;
      latency_ms: number;
      outcome?: "SUCCESS" | "FAILURE" | "OTHER";
      failure_reason?: string;
      request_body?: unknown;
      response_body?: unknown;
      current_screen?: string;
    }
  | {
      kind: "click";
      occurred_at: string;
      action_index: number;
      label: string;
      target?: string;
      screen?: string;
    }
  | {
      kind: "system";
      occurred_at: string;
      action_index: number;
      message?: string;
    }
  | {
      kind: "screen_view";
      occurred_at: string;
      action_index: number;
      screen: string;
      from_screen?: string;
    }
  | {
      kind: "form_start";
      occurred_at: string;
      action_index: number;
      form: string;
      screen?: string;
    }
  | {
      kind: "form_submit";
      occurred_at: string;
      action_index: number;
      form: string;
      screen?: string;
      success?: boolean;
    }
  | {
      kind: "search";
      occurred_at: string;
      action_index: number;
      query: string;
      screen?: string;
      results_count?: number;
    }
  | {
      kind: "filter";
      occurred_at: string;
      action_index: number;
      filter: string;
      value?: string;
      screen?: string;
    }
  | {
      kind: "modal_open";
      occurred_at: string;
      action_index: number;
      modal: string;
      screen?: string;
    }
  | {
      kind: "modal_close";
      occurred_at: string;
      action_index: number;
      modal: string;
      screen?: string;
    }
  | {
      kind: "download";
      occurred_at: string;
      action_index: number;
      file: string;
      screen?: string;
    }
  | {
      kind: "file_upload";
      occurred_at: string;
      action_index: number;
      file: string;
      screen?: string;
      size_bytes?: number;
    }
  | {
      kind: "purchase_start";
      occurred_at: string;
      action_index: number;
      item?: string;
      amount?: number;
      currency?: string;
      screen?: string;
    }
  | {
      kind: "purchase_complete";
      occurred_at: string;
      action_index: number;
      item?: string;
      amount?: number;
      currency?: string;
      order_id?: string;
      screen?: string;
    }
  | {
      kind: "logout";
      occurred_at: string;
      action_index: number;
      screen?: string;
    };

export type MonitorEnvelope = {
  schema: "monitor.v1";
  sent_at: string;
  session: {
    id: string;
    started_at?: string;
    user_id?: string;
    email?: string;
    role?: string;
    account_type?: string;
  };
  context?: MonitorContext;
  events: EnvelopeEvent[];
};
