import { classifyNetworkFailure, deriveOutcome } from "./mapping.js";
import { clipAndRedactBody } from "./redact.js";
import type {
  EnvelopeEvent,
  MonitorContext,
  MonitorEnvelope,
  MonitorInit,
  MonitorUser,
} from "./types.js";

function randomId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function snapshotRequestBody(init?: RequestInit): unknown {
  const body = init?.body;
  if (body == null || body === "") return undefined;
  if (typeof body === "string") return clipAndRedactBody(body);
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return clipAndRedactBody(body.toString());
  }
  return "[non-json-body]";
}

function parseBodyText(text: string): unknown {
  if (!text) return undefined;
  return clipAndRedactBody(text);
}

export class MonitorClient {
  private readonly ingestUrl: string;
  private readonly apiKey: string;
  private allowedHosts: string[];
  private readonly flushIntervalMs: number;
  private readonly maxQueue: number;
  private readonly fetchImpl: typeof fetch;
  private readonly source: "mobile" | "web";
  private queue: EnvelopeEvent[] = [];
  private flushing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private actionIndex = 0;
  readonly sessionId: string;
  readonly startedAt: string;
  private user: MonitorUser = {};
  private context: MonitorContext = {};
  private currentScreen: string | undefined;

  constructor(opts: MonitorInit) {
    this.ingestUrl = opts.ingestUrl.replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.allowedHosts = opts.allowedHosts ?? [];
    this.flushIntervalMs = opts.flushIntervalMs ?? 5000;
    this.maxQueue = opts.maxQueue ?? 200;
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.source = opts.source ?? "web";
    this.sessionId = randomId();
    this.startedAt = nowIso();
    this.context.source = this.source;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  setAllowedHosts(hosts: string[]): void {
    this.allowedHosts = hosts;
  }

  setUser(user: MonitorUser): void {
    this.user = { ...this.user, ...user };
    this.enqueue({
      kind: "auth",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      message: "Session bound",
    });
  }

  setScreen(screen: string): void {
    this.currentScreen = screen;
    this.context.screen = screen;
  }

  setContext(partial: MonitorContext): void {
    this.context = { ...this.context, ...partial };
  }

  captureNavigation(screen: string, from?: string): void {
    const fromScreen = from ?? this.currentScreen;
    this.setScreen(screen);
    this.enqueue({
      kind: "navigation",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      screen,
      from_screen: fromScreen,
      message: fromScreen ? `Navigation: ${fromScreen} → ${screen}` : `Opened ${screen}`,
    });
  }

  captureLifecycle(message: string): void {
    this.enqueue({
      kind: "lifecycle",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      message,
    });
  }

  captureSystem(message?: string): void {
    this.enqueue({
      kind: "system",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      message,
    });
  }

  captureClick(input: { label: string; target?: string; screen?: string }): void {
    this.enqueue({
      kind: "click",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      label: input.label.slice(0, 256),
      target: input.target,
      screen: input.screen ?? this.currentScreen,
    });
  }

  captureScreenView(screen: string, from?: string): void {
    this.enqueue({
      kind: "screen_view",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      screen,
      from_screen: from ?? this.currentScreen,
    });
  }

  captureFormStart(input: { form: string; screen?: string }): void {
    this.enqueue({
      kind: "form_start",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      form: input.form,
      screen: input.screen ?? this.currentScreen,
    });
  }

  captureFormSubmit(input: { form: string; screen?: string; success?: boolean }): void {
    this.enqueue({
      kind: "form_submit",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      form: input.form,
      screen: input.screen ?? this.currentScreen,
      success: input.success,
    });
  }

  captureSearch(input: { query: string; screen?: string; resultsCount?: number }): void {
    this.enqueue({
      kind: "search",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      query: input.query.slice(0, 512),
      screen: input.screen ?? this.currentScreen,
      results_count: input.resultsCount,
    });
  }

  captureFilter(input: { filter: string; value?: string; screen?: string }): void {
    this.enqueue({
      kind: "filter",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      filter: input.filter,
      value: input.value,
      screen: input.screen ?? this.currentScreen,
    });
  }

  captureModalOpen(input: { modal: string; screen?: string }): void {
    this.enqueue({
      kind: "modal_open",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      modal: input.modal,
      screen: input.screen ?? this.currentScreen,
    });
  }

  captureModalClose(input: { modal: string; screen?: string }): void {
    this.enqueue({
      kind: "modal_close",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      modal: input.modal,
      screen: input.screen ?? this.currentScreen,
    });
  }

  captureDownload(input: { file: string; screen?: string }): void {
    this.enqueue({
      kind: "download",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      file: input.file.slice(0, 512),
      screen: input.screen ?? this.currentScreen,
    });
  }

  captureFileUpload(input: { file: string; screen?: string; sizeBytes?: number }): void {
    this.enqueue({
      kind: "file_upload",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      file: input.file.slice(0, 512),
      screen: input.screen ?? this.currentScreen,
      size_bytes: input.sizeBytes,
    });
  }

  capturePurchaseStart(input: { item?: string; amount?: number; currency?: string; screen?: string }): void {
    this.enqueue({
      kind: "purchase_start",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      item: input.item,
      amount: input.amount,
      currency: input.currency,
      screen: input.screen ?? this.currentScreen,
    });
  }

  capturePurchaseComplete(input: {
    item?: string;
    amount?: number;
    currency?: string;
    orderId?: string;
    screen?: string;
  }): void {
    this.enqueue({
      kind: "purchase_complete",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      item: input.item,
      amount: input.amount,
      currency: input.currency,
      order_id: input.orderId,
      screen: input.screen ?? this.currentScreen,
    });
  }

  captureLogout(screen?: string): void {
    this.enqueue({
      kind: "logout",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      screen: screen ?? this.currentScreen,
    });
  }

  captureApi(input: {
    url: string;
    method?: string;
    statusCode: number;
    latencyMs: number;
    failureReason?: string;
    requestBody?: unknown;
    responseBody?: unknown;
  }): void {
    if (input.url.startsWith(this.ingestUrl)) return;
    this.enqueue({
      kind: "api",
      occurred_at: nowIso(),
      action_index: this.nextIndex(),
      request_url: input.url,
      http_method: input.method,
      status_code: input.statusCode,
      latency_ms: Math.max(0, Math.round(input.latencyMs)),
      outcome: deriveOutcome(input.statusCode),
      failure_reason: input.failureReason,
      request_body: clipAndRedactBody(input.requestBody),
      response_body: clipAndRedactBody(input.responseBody),
      current_screen: this.currentScreen,
    });
  }

  wrapFetch(base: typeof fetch = this.fetchImpl): typeof fetch {
    const client = this;
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") || "GET").toUpperCase();
      const start = Date.now();
      const requestBody = snapshotRequestBody(init);
      if (url.startsWith(client.ingestUrl)) {
        return base(input, init);
      }
      try {
        const res = await base(input, init);
        const latencyMs = Date.now() - start;
        const statusCode = res.status;
        void res
          .clone()
          .text()
          .then((text) => {
            client.captureApi({
              url,
              method,
              statusCode,
              latencyMs,
              requestBody,
              responseBody: parseBodyText(text),
            });
          })
          .catch(() => {
            client.captureApi({ url, method, statusCode, latencyMs, requestBody });
          });
        return res;
      } catch (err) {
        client.captureApi({
          url,
          method,
          statusCode: 0,
          latencyMs: Date.now() - start,
          failureReason: classifyNetworkFailure(err),
          requestBody,
        });
        throw err;
      }
    };
  }

  wrapAxios<T extends {
    interceptors: {
      request: { use: (onFulfilled: (cfg: Record<string, unknown>) => Record<string, unknown>) => void };
      response: {
        use: (
          onFulfilled: (res: { config?: Record<string, unknown>; status: number; data?: unknown }) => unknown,
          onRejected: (err: { config?: Record<string, unknown>; message?: string; code?: string }) => unknown
        ) => void;
      };
    };
  }>(instance: T): T {
    instance.interceptors.request.use((cfg) => {
      cfg.__monitorStart = Date.now();
      return cfg;
    });
    instance.interceptors.response.use(
      (res) => {
        const cfg = res.config ?? {};
        const url = String(cfg.url ?? cfg.baseURL ?? "");
        const start = Number(cfg.__monitorStart ?? Date.now());
        this.captureApi({
          url,
          method: String(cfg.method ?? "GET").toUpperCase(),
          statusCode: res.status,
          latencyMs: Date.now() - start,
          requestBody: clipAndRedactBody(cfg.data),
          responseBody: clipAndRedactBody(res.data),
        });
        return res;
      },
      (err) => {
        const cfg = err.config ?? {};
        const url = String(cfg.url ?? "");
        const start = Number(cfg.__monitorStart ?? Date.now());
        this.captureApi({
          url,
          method: String(cfg.method ?? "GET").toUpperCase(),
          statusCode: 0,
          latencyMs: Date.now() - start,
          failureReason: classifyNetworkFailure(err.message || err.code),
          requestBody: clipAndRedactBody(cfg.data),
        });
        return Promise.reject(err);
      }
    );
    return instance;
  }

  async refreshConfig(): Promise<void> {
    try {
      const res = await this.fetchImpl(`${this.ingestUrl.replace(/\/ingest\/v1$/, "")}/ingest/v1/config`, {
        headers: { "X-Monitor-Key": this.apiKey },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { allowedHosts?: string[] };
      if (Array.isArray(body.allowedHosts) && body.allowedHosts.length) {
        this.allowedHosts = body.allowedHosts;
      }
    } catch {
      /* offline */
    }
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const events = this.queue.splice(0, this.queue.length);
    const envelope: MonitorEnvelope = {
      schema: "monitor.v1",
      sent_at: nowIso(),
      session: {
        id: this.sessionId,
        started_at: this.startedAt,
        user_id: this.user.id,
        email: this.user.email,
        role: this.user.role,
        account_type: this.user.accountType,
      },
      context: { ...this.context, source: this.source, screen: this.currentScreen },
      events,
    };
    try {
      const res = await this.fetchImpl(this.ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Monitor-Key": this.apiKey,
        },
        body: JSON.stringify(envelope),
      });
      if (!res.ok && res.status >= 500) {
        this.requeue(events);
      }
    } catch {
      this.requeue(events);
    } finally {
      this.flushing = false;
    }
  }

  shutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.flush();
  }

  private nextIndex(): number {
    const n = this.actionIndex;
    this.actionIndex += 1;
    return n;
  }

  private enqueue(event: EnvelopeEvent): void {
    if (this.queue.length >= this.maxQueue) this.queue.shift();
    this.queue.push(event);
  }

  private requeue(events: EnvelopeEvent[]): void {
    this.queue = [...events, ...this.queue].slice(-this.maxQueue);
  }
}

let singleton: MonitorClient | null = null;

export function init(opts: MonitorInit): MonitorClient {
  singleton?.shutdown();
  singleton = new MonitorClient(opts);
  void singleton.refreshConfig();
  singleton.captureLifecycle("session_start");
  return singleton;
}

export function getClient(): MonitorClient | null {
  return singleton;
}

export function setUser(user: MonitorUser): void {
  singleton?.setUser(user);
}

export function setScreen(screen: string): void {
  singleton?.setScreen(screen);
}

export function setContext(partial: MonitorContext): void {
  singleton?.setContext(partial);
}

export function captureNavigation(screen: string, from?: string): void {
  singleton?.captureNavigation(screen, from);
}

export function captureClick(input: { label: string; target?: string; screen?: string }): void {
  singleton?.captureClick(input);
}

export function captureLifecycle(message: string): void {
  singleton?.captureLifecycle(message);
}

export function captureScreenView(screen: string, from?: string): void {
  singleton?.captureScreenView(screen, from);
}

export function captureFormStart(input: { form: string; screen?: string }): void {
  singleton?.captureFormStart(input);
}

export function captureFormSubmit(input: { form: string; screen?: string; success?: boolean }): void {
  singleton?.captureFormSubmit(input);
}

export function captureSearch(input: { query: string; screen?: string; resultsCount?: number }): void {
  singleton?.captureSearch(input);
}

export function captureFilter(input: { filter: string; value?: string; screen?: string }): void {
  singleton?.captureFilter(input);
}

export function captureModalOpen(input: { modal: string; screen?: string }): void {
  singleton?.captureModalOpen(input);
}

export function captureModalClose(input: { modal: string; screen?: string }): void {
  singleton?.captureModalClose(input);
}

export function captureDownload(input: { file: string; screen?: string }): void {
  singleton?.captureDownload(input);
}

export function captureFileUpload(input: { file: string; screen?: string; sizeBytes?: number }): void {
  singleton?.captureFileUpload(input);
}

export function capturePurchaseStart(input: {
  item?: string;
  amount?: number;
  currency?: string;
  screen?: string;
}): void {
  singleton?.capturePurchaseStart(input);
}

export function capturePurchaseComplete(input: {
  item?: string;
  amount?: number;
  currency?: string;
  orderId?: string;
  screen?: string;
}): void {
  singleton?.capturePurchaseComplete(input);
}

export function captureLogout(screen?: string): void {
  singleton?.captureLogout(screen);
}

export function wrapFetch(base?: typeof fetch): typeof fetch {
  if (!singleton) return base ?? fetch.bind(globalThis);
  return singleton.wrapFetch(base);
}
