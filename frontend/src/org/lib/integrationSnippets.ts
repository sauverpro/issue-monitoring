export type IntegrationInfo = {
  ingestUrl: string;
  configUrl: string;
  deviceIngestUrl?: string;
  androidEmulatorIngestUrl?: string;
  platform: "react-native" | "web";
  allowedHosts: string[];
  packages: { web: string; reactNative: string };
};

export type SnippetTab = "curl" | "fetch" | "axios" | "sdk-web" | "sdk-rn";

function exampleApiUrl(hosts: string[]): string {
  const host = hosts[0] ?? "api.example.com";
  return `https://${host}/health`;
}

/** Phone / emulator must not use localhost (that is the device, not this PC). */
export function appIngestUrl(info: IntegrationInfo): string {
  return info.deviceIngestUrl ?? info.ingestUrl;
}

export function snippetFor(tab: SnippetTab, info: IntegrationInfo): string {
  const apiUrl = exampleApiUrl(info.allowedHosts);
  const appUrl = appIngestUrl(info);

  if (tab === "curl") {
    const body = JSON.stringify(
      {
        schema: "monitor.v1",
        sent_at: "2026-09-01T12:00:00.000Z",
        session: { id: "sess-1", email: "qa@example.com" },
        context: { source: "web", platform: "curl" },
        events: [
          {
            kind: "navigation",
            occurred_at: "2026-09-01T12:00:01.000Z",
            action_index: 0,
            screen: "/home",
          },
          {
            kind: "api",
            occurred_at: "2026-09-01T12:00:02.000Z",
            action_index: 1,
            request_url: apiUrl,
            http_method: "GET",
            status_code: 200,
            latency_ms: 42,
          },
        ],
      },
      null,
      2
    );
    return `export INGEST="${info.ingestUrl}"
export KEY="mntr_YOUR_PROJECT_KEY"

# 1) Confirm allowlisted hosts
curl -sS -H "X-Monitor-Key: $KEY" "${info.configUrl}"

# 2) Send a session + API event (host must be in Settings)
curl -sS -X POST "$INGEST" \\
  -H "Content-Type: application/json" \\
  -H "X-Monitor-Key: $KEY" \\
  -d '${body}'`;
  }

  if (tab === "fetch") {
    return `const INGEST_URL = "${appUrl}";
const API_KEY = "mntr_YOUR_PROJECT_KEY";

const session = {
  id: crypto.randomUUID(),
  started_at: new Date().toISOString(),
};
let actionIndex = 0;

function skipIngest(url) {
  return typeof url === "string" && url.startsWith(INGEST_URL);
}

function parseBody(text) {
  if (!text) return undefined;
  try { return JSON.parse(text); } catch { return text.slice(0, 131072); }
}

export async function postMonitor(events, user) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Monitor-Key": API_KEY,
    },
    body: JSON.stringify({
      schema: "monitor.v1",
      sent_at: new Date().toISOString(),
      session: { ...session, ...user },
      context: { source: "web", platform: navigator.userAgent, screen: location.pathname },
      events,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json(); // { ok, accepted, dropped }
}

export function identify(user) {
  return postMonitor(
    [{ kind: "auth", occurred_at: new Date().toISOString(), action_index: actionIndex++, message: "login" }],
    user
  );
}

export function trackScreen(screen, fromScreen) {
  return postMonitor([{
    kind: "navigation",
    occurred_at: new Date().toISOString(),
    action_index: actionIndex++,
    screen,
    from_screen: fromScreen,
    message: fromScreen ? \`\${fromScreen} → \${screen}\` : \`Opened \${screen}\`,
  }]);
}

export function trackClick(label, target) {
  return postMonitor([{
    kind: "click",
    occurred_at: new Date().toISOString(),
    action_index: actionIndex++,
    label,
    target,
    screen: location.pathname,
  }]);
}

export async function monitoredFetch(input, init) {
  const started = Date.now();
  const requestUrl = typeof input === "string" ? input : input.url;
  const requestBody = typeof init?.body === "string" ? parseBody(init.body) : undefined;
  if (skipIngest(requestUrl)) return fetch(input, init);
  try {
    const res = await fetch(input, init);
    const responseBody = parseBody(await res.clone().text());
    void postMonitor([{
      kind: "api",
      occurred_at: new Date().toISOString(),
      action_index: actionIndex++,
      request_url: requestUrl,
      http_method: (init?.method ?? "GET").toUpperCase(),
      status_code: res.status,
      latency_ms: Date.now() - started,
      request_body: requestBody,
      response_body: responseBody,
      current_screen: location.pathname,
    }]);
    return res;
  } catch (err) {
    void postMonitor([{
      kind: "api",
      occurred_at: new Date().toISOString(),
      action_index: actionIndex++,
      request_url: requestUrl,
      http_method: (init?.method ?? "GET").toUpperCase(),
      status_code: 0,
      latency_ms: Date.now() - started,
      outcome: "OTHER",
      failure_reason: "network",
      request_body: requestBody,
    }]);
    throw err;
  }
}

// identify({ id: user.id, email: user.email, role: user.role })
// trackScreen("/Wallet")
// trackClick("Pay now", "button")
// globalThis.fetch = monitoredFetch;`;
  }

  if (tab === "axios") {
    const source = info.platform === "react-native" ? "mobile" : "web";
    return `// ============================================================================
// Monitor · full axios integration (no SDK package) — monitor.ts
// Copy this whole file into your app once. Everything below sends events to:
//   POST ${appUrl}
// with header  X-Monitor-Key: mntr_YOUR_PROJECT_KEY
//
// 1) Setup + session bootstrap
// 2) postMonitor()            — the only function that talks to the network
// 3) identify() / trackLogout — who is using the app
// 4) trackNavigation / trackScreenView / setScreen — where they are
// 5) trackClick / trackFormStart / trackFormSubmit / trackSearch / trackFilter
//    / trackModalOpen / trackModalClose / trackDownload / trackFileUpload
//    / trackPurchaseStart / trackPurchaseComplete — what they did
// 6) axios interceptors        — every HTTP call, automatic, no extra code
// 7) Usage examples at the bottom
// ============================================================================

import axios from "axios";

const INGEST_URL = "${appUrl}";
const API_KEY = "mntr_YOUR_PROJECT_KEY";

// -- 1) Setup + session bootstrap ------------------------------------------
// One id for the whole app visit (cold start to background/close). Persist it
// (AsyncStorage / SecureStore) if you want it to survive an app relaunch —
// otherwise a new id per cold start is fine.
function randomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "s_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

const session = { id: randomId(), started_at: new Date().toISOString() };
let user = {}; // set by identify()
let currentScreen; // set by setScreen() / trackNavigation()
let actionIndex = 0; // monotonic counter — every event increments this

function nowIso() {
  return new Date().toISOString();
}
function nextIndex() {
  return actionIndex++;
}

// -- 2) postMonitor — the only function that talks to the network ---------
// Every track*() helper below ends up calling this. Fire-and-forget: never
// block the UI or a purchase flow on analytics.
async function postMonitor(events) {
  try {
    await axios.post(
      INGEST_URL,
      {
        schema: "monitor.v1",
        sent_at: nowIso(),
        session: { ...session, ...user },
        context: { source: "${source}", screen: currentScreen },
        events,
      },
      { headers: { "X-Monitor-Key": API_KEY }, timeout: 5000 }
    );
  } catch {
    // Swallow — never let a monitoring failure break the app.
  }
}

// -- 3) Identify the signed-in user / logout -------------------------------
// Call as soon as you know who the user is (after login, or on cold start if
// a session token is already stored). All fields optional except call it.
export function identify({ id, email, role, accountType } = {}) {
  user = { user_id: id, email, role, account_type: accountType };
  return postMonitor([
    { kind: "auth", occurred_at: nowIso(), action_index: nextIndex(), message: "login" },
  ]);
}

export function trackLogout() {
  return postMonitor([
    { kind: "logout", occurred_at: nowIso(), action_index: nextIndex(), screen: currentScreen },
  ]).finally(() => {
    user = {};
  });
}

// -- 4) Screens --------------------------------------------------------------
// setScreen: call whenever the route/tab changes, so every later event
// (clicks, forms, purchases...) is tagged with the right screen automatically.
export function setScreen(screen) {
  currentScreen = screen;
}

// trackNavigation: a route/URL transition (from -> to). Fires on every
// navigation, cheap and automatic-feeling — wire it into your router.
export function trackNavigation(screen, fromScreen) {
  const from = fromScreen ?? currentScreen;
  setScreen(screen);
  return postMonitor([{
    kind: "navigation",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    screen, // required, max 256
    from_screen: from, // optional
    message: from ? \`\${from} -> \${screen}\` : \`Opened \${screen}\`, // optional, max 512
  }]);
}

// trackScreenView: an *explicit* meaningful pageview — distinct from
// trackNavigation. Use this once the screen's data has actually loaded
// (e.g. after a product/ticket detail fetch resolves), not on every route change.
export function trackScreenView(screen, fromScreen) {
  return postMonitor([{
    kind: "screen_view",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    screen, // required, max 256
    from_screen: fromScreen ?? currentScreen, // optional
  }]);
}

// -- 5) What the user did -----------------------------------------------

export function trackClick(label, target) {
  return postMonitor([{
    kind: "click",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    label, // required, 1-256 — button/link title
    target, // optional, max 128 — e.g. "Pressable", "button"
    screen: currentScreen, // optional
  }]);
}

export function trackLifecycle(message) {
  return postMonitor([{
    kind: "lifecycle",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    message, // required, 1-512 — e.g. "app_start", "foreground", "background"
  }]);
}

export function trackFormStart(form) {
  return postMonitor([{
    kind: "form_start",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    form, // required, max 256 — e.g. "checkout", "create_listing"
    screen: currentScreen, // optional
  }]);
}

export function trackFormSubmit(form, success) {
  return postMonitor([{
    kind: "form_submit",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    form, // required, max 256
    screen: currentScreen, // optional
    success, // optional, boolean
  }]);
}

export function trackSearch(query, resultsCount) {
  return postMonitor([{
    kind: "search",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    query, // required, max 512
    screen: currentScreen, // optional
    results_count: resultsCount, // optional, integer >= 0
  }]);
}

export function trackFilter(filter, value) {
  return postMonitor([{
    kind: "filter",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    filter, // required, max 256 — e.g. "category", "price_range"
    value, // optional, max 256 — e.g. "electronics", "0-50"
    screen: currentScreen, // optional
  }]);
}

export function trackModalOpen(modal) {
  return postMonitor([{
    kind: "modal_open",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    modal, // required, max 256 — a stable modal name
    screen: currentScreen, // optional
  }]);
}

export function trackModalClose(modal) {
  return postMonitor([{
    kind: "modal_close",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    modal, // required, max 256
    screen: currentScreen, // optional
  }]);
}

export function trackDownload(file) {
  return postMonitor([{
    kind: "download",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    file, // required, max 512 — filename or URL
    screen: currentScreen, // optional
  }]);
}

export function trackFileUpload(file, sizeBytes) {
  return postMonitor([{
    kind: "file_upload",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    file, // required, max 512
    screen: currentScreen, // optional
    size_bytes: sizeBytes, // optional, integer >= 0
  }]);
}

export function trackPurchaseStart({ item, amount, currency } = {}) {
  return postMonitor([{
    kind: "purchase_start",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    item, // optional, max 256
    amount, // optional, number
    currency, // optional, max 8 — e.g. "USD", "RWF"
    screen: currentScreen, // optional
  }]);
}

export function trackPurchaseComplete({ item, amount, currency, orderId } = {}) {
  return postMonitor([{
    kind: "purchase_complete",
    occurred_at: nowIso(),
    action_index: nextIndex(),
    item, // optional, max 256
    amount, // optional, number
    currency, // optional, max 8
    order_id: orderId, // optional, max 256
    screen: currentScreen, // optional
  }]);
}

// -- 6) Every HTTP call, automatic — attach once, near app start ----------
// Captures request + response body (redacted server-side for passwords /
// tokens / pins), status, method, and real latency for every axios call
// EXCEPT calls to INGEST_URL itself (never track the tracker).

function resolveUrl(cfg) {
  const raw = cfg.url ?? "";
  if (/^https?:\\/\\//i.test(raw)) return raw;
  return \`\${cfg.baseURL ?? ""}\${raw}\`;
}

function skipIngest(url) {
  return url.startsWith(INGEST_URL);
}

axios.interceptors.request.use((cfg) => {
  cfg.__monitorStart = Date.now();
  return cfg;
});

axios.interceptors.response.use(
  (res) => {
    const url = resolveUrl(res.config);
    if (!skipIngest(url)) {
      void postMonitor([{
        kind: "api",
        occurred_at: nowIso(),
        action_index: nextIndex(),
        request_url: url, // required, max 4096
        http_method: (res.config.method ?? "get").toUpperCase(), // optional
        status_code: res.status, // required, 0-599
        latency_ms: Date.now() - (res.config.__monitorStart ?? Date.now()), // required, >= 0
        request_body: res.config.data, // optional — redacted server-side
        response_body: res.data, // optional — redacted server-side, send for 2xx too
        current_screen: currentScreen, // optional
      }]);
    }
    return res;
  },
  (err) => {
    const cfg = err.config ?? {};
    const url = resolveUrl(cfg);
    if (!skipIngest(url)) {
      void postMonitor([{
        kind: "api",
        occurred_at: nowIso(),
        action_index: nextIndex(),
        request_url: url,
        http_method: (cfg.method ?? "get").toUpperCase(),
        status_code: err.response?.status ?? 0, // 0 = network failure (no response)
        latency_ms: Date.now() - (cfg.__monitorStart ?? Date.now()),
        outcome: err.response ? "FAILURE" : "OTHER",
        failure_reason: err.response ? undefined : "network", // optional, max 256
        request_body: cfg.data,
        response_body: err.response?.data,
        current_screen: currentScreen,
      }]);
    }
    return Promise.reject(err);
  }
);

// -- 7) Usage ---------------------------------------------------------------
// import { identify, setScreen, trackNavigation, trackClick, trackSearch,
//   trackFilter, trackFormStart, trackFormSubmit, trackModalOpen,
//   trackModalClose, trackDownload, trackFileUpload, trackPurchaseStart,
//   trackPurchaseComplete, trackLogout, trackLifecycle } from "./monitor";
//
// identify({ id: user.id, email: user.email, role: user.role, accountType: user.accountType });
// trackLifecycle("app_start");
// setScreen("/marketplace/home");                 // on cold start / first route
// trackNavigation("/tickets/123", "/marketplace/home"); // on every route change
// trackScreenView("/tickets/123");                 // once the ticket detail has loaded
// trackClick("Buy ticket", "Pressable");
// trackFormStart("checkout");
// trackSearch("concert", 12);
// trackFilter("category", "music");
// trackModalOpen("confirm_purchase");
// trackPurchaseStart({ item: "Concert ticket", amount: 25, currency: "USD" });
// trackFormSubmit("checkout", true);
// trackModalClose("confirm_purchase");
// trackPurchaseComplete({ item: "Concert ticket", amount: 25, currency: "USD", orderId: "ord_123" });
// trackDownload("receipt.pdf");
// trackFileUpload("id_card.jpg", 204800);
// trackLogout();
// // Every axios.get/post/put/delete call anywhere in the app is captured
// // automatically by the interceptors above — no extra code needed.`;
  }

  if (tab === "sdk-web") {
    return `import {
  init,
  setUser,
  captureSearch,
  captureFilter,
  captureModalOpen,
  captureModalClose,
  capturePurchaseStart,
  capturePurchaseComplete,
  captureLogout,
} from "${info.packages.web}";

init({
  ingestUrl: "${info.ingestUrl}",
  apiKey: "mntr_YOUR_PROJECT_KEY",
});

setUser({ id: user.id, email: user.email, role: user.role });

// Auto-captured: clicks (button/a/[role=button]), screen views (history),
// form_start/form_submit (any <form>), file_upload (<input type="file">),
// and download (<a download> or a link ending in .pdf/.csv/.zip/…).
// Add data-monitor-modal-open="name" / data-monitor-modal-close="name" /
// data-monitor-logout on an element to auto-capture those too.

// Everything else is a manual call at the point it happens:
// captureSearch({ query: "concert", resultsCount: 12 })
// captureFilter({ filter: "category", value: "music" })
// captureModalOpen({ modal: "confirm_purchase" })
// captureModalClose({ modal: "confirm_purchase" })
// capturePurchaseStart({ item: "Concert ticket", amount: 25, currency: "USD" })
// capturePurchaseComplete({ item: "Concert ticket", amount: 25, currency: "USD", orderId: "ord_123" })
// captureLogout()`;
  }

  return `import {
  init,
  setUser,
  wrapFetch,
  captureClick,
  captureScreenView,
  captureFormStart,
  captureFormSubmit,
  captureSearch,
  captureFilter,
  captureModalOpen,
  captureModalClose,
  captureDownload,
  captureFileUpload,
  capturePurchaseStart,
  capturePurchaseComplete,
  captureLogout,
  onNavigationStateChange,
  onAppStateChange,
} from "${info.packages.reactNative}";
import { AppState } from "react-native";

init({
  ingestUrl: "${appUrl}",
  apiKey: "mntr_YOUR_PROJECT_KEY",
});

globalThis.fetch = wrapFetch(globalThis.fetch);
AppState.addEventListener("change", onAppStateChange);
setUser({ id, email, role, accountType });

// <NavigationContainer onStateChange={onNavigationStateChange} />
// captureClick({ label: "Pay now", target: "Pressable" })

// Optional behavior events — call these at the point they happen in the app.
// They show up in the session timeline, User Behavior, and Funnels.
// captureScreenView("/tickets/123")                 // explicit pageview, once data has loaded
// captureFormStart({ form: "checkout" })
// captureFormSubmit({ form: "checkout", success: true })
// captureSearch({ query: "concert", resultsCount: 12 })
// captureFilter({ filter: "category", value: "music" })
// captureModalOpen({ modal: "confirm_purchase" })
// captureModalClose({ modal: "confirm_purchase" })
// captureDownload({ file: "receipt.pdf" })
// captureFileUpload({ file: "id_card.jpg", sizeBytes: 204800 })
// capturePurchaseStart({ item: "Concert ticket", amount: 25, currency: "USD" })
// capturePurchaseComplete({ item: "Concert ticket", amount: 25, currency: "USD", orderId: "ord_123" })
// captureLogout()`;
}

export const TAB_LABELS: Record<SnippetTab, string> = {
  curl: "curl",
  fetch: "fetch",
  axios: "axios",
  "sdk-web": "SDK · web",
  "sdk-rn": "SDK · RN",
};
