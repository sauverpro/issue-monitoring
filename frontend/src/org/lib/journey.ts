import type { JourneyMapNode, SessionAction } from "@/org/types";

export function localISODate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dayBounds(dateStr: string): { from: string; to: string } {
  const from = new Date(`${dateStr}T00:00:00`);
  const to = new Date(`${dateStr}T23:59:59.999`);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function rangeForPreset(preset: "today" | "7d" | "30d"): { from: string; to: string } {
  const now = new Date();
  if (preset === "today") return dayBounds(localISODate(now));
  const days = preset === "7d" ? 7 : 30;
  const from = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  from.setHours(0, 0, 0, 0);
  return { from: from.toISOString(), to: now.toISOString() };
}

export function encodeUserKey(userId: string | null | undefined, email: string | null | undefined): string {
  return encodeURIComponent(userId || email || "");
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${s}s`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export function formatDayHeading(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).toUpperCase();
}

export function dayLabel(dateStr: string): string {
  const today = localISODate();
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (dateStr === today) return "Today";
  if (dateStr === localISODate(y)) return "Yesterday";
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatClockHm(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function eventDomId(id: string): string {
  return `evt-${id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)}`;
}

export function pathOnly(url: string | null | undefined): string {
  if (!url) return "";
  try {
    if (url.startsWith("http")) return new URL(url).pathname || url;
  } catch {
    /* ignore */
  }
  return url.split("?")[0] ?? url;
}

export function queryEntries(url: string | null | undefined): [string, string][] {
  if (!url) return [];
  try {
    const u = url.startsWith("http") ? new URL(url) : new URL(url, "https://local.invalid");
    return [...u.searchParams.entries()];
  } catch {
    const q = url.split("?")[1];
    if (!q) return [];
    return q.split("&").map((part) => {
      const [k, v] = part.split("=");
      return [decodeURIComponent(k ?? ""), decodeURIComponent(v ?? "")] as [string, string];
    });
  }
}

export function statusPhrase(httpStatus: string | null | undefined): string {
  if (!httpStatus) return "";
  const n = parseInt(httpStatus, 10);
  const names: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
  };
  if (!Number.isNaN(n) && names[n]) return `${n} ${names[n]}`;
  return httpStatus;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2).replace(/\.?0+$/, "")}s`;
  return `${ms}ms`;
}

export type TimelineKind = "screen" | "api" | "api_failure" | "action" | "error" | "session" | "lifecycle" | "other";

const INTERACTION_KINDS = new Set([
  "click",
  "form_start",
  "form_submit",
  "search",
  "filter",
  "modal_open",
  "modal_close",
  "download",
  "file_upload",
  "purchase_start",
  "purchase_complete",
]);

export function classifyKind(a: SessionAction): TimelineKind {
  const t = (a.actionType ?? "").toLowerCase();
  if (t === "navigation" || t === "screen_view") return "screen";
  if (INTERACTION_KINDS.has(t)) return "action";
  if (t === "auth" || t === "logout") return "session";
  if (t === "lifecycle") {
    const msg = (a.message ?? "").toLowerCase();
    if (msg.includes("fail") || msg.includes("error")) return "error";
    return "lifecycle";
  }
  const isApi = t === "api_call" || t.includes("api") || Boolean(a.method || a.httpStatus);
  if (isApi) return a.status === "failure" ? "api_failure" : "api";
  return "other";
}

export function isApiAction(a: SessionAction): boolean {
  const k = classifyKind(a);
  return k === "api" || k === "api_failure";
}

export function compactTitle(a: SessionAction): string {
  const k = classifyKind(a);
  if (k === "screen") return a.message || `Opened ${a.screen || a.endpoint || "screen"}`;
  if (k === "action") {
    const t = (a.actionType ?? "").toLowerCase();
    if (t === "click") return a.message ? `Clicked "${a.message}"` : "Button click";
    return a.message || "Action";
  }
  if (k === "session") return a.message || "Session start";
  if (k === "error") return a.message || "Error";
  if (k === "lifecycle") return a.message || "Lifecycle";
  return `${a.method || "GET"} ${pathOnly(a.endpoint)}`;
}

export function prettyJson(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export type ScreenFlowNode = {
  time: string;
  label: string;
  failed: boolean;
  kind: TimelineKind;
};

export function buildScreenFlow(actions: SessionAction[]): ScreenFlowNode[] {
  const nodes: ScreenFlowNode[] = [];
  let last = "";
  for (const a of actions) {
    const k = classifyKind(a);
    if (k === "screen" || k === "session" || k === "action") {
      const label = k === "action" ? compactTitle(a) : a.screen || compactTitle(a);
      if (label === last && k !== "action") continue;
      nodes.push({ time: a.timestamp, label, failed: false, kind: k });
      last = label;
    } else if (k === "api_failure" || k === "error") {
      nodes.push({
        time: a.timestamp,
        label: k === "api_failure" ? "API Error" : compactTitle(a),
        failed: true,
        kind: k,
      });
    }
  }
  return nodes;
}

export function buildJourneyMap(actions: SessionAction[]): JourneyMapNode[] {
  const nodes: JourneyMapNode[] = [];
  let current: JourneyMapNode | null = null;
  let lastScreen: string | null = null;
  for (const a of actions) {
    const t = (a.actionType ?? "").toLowerCase();
    const screenName =
      t === "navigation" ? a.screen || a.endpoint || a.message || "Unknown" : a.screen;
    if (t === "navigation" && screenName && screenName !== lastScreen) {
      current = { screen: screenName, time: a.timestamp, apiTotal: 0, apiOk: 0, apiFail: 0, failed: false };
      nodes.push(current);
      lastScreen = screenName;
      continue;
    }
    if (!current && screenName) {
      current = { screen: screenName, time: a.timestamp, apiTotal: 0, apiOk: 0, apiFail: 0, failed: false };
      nodes.push(current);
      lastScreen = screenName;
    }
    if (isApiAction(a) && current) {
      current.apiTotal += 1;
      if (a.status === "failure") {
        current.apiFail += 1;
        current.failed = true;
      } else if (a.status === "success") {
        current.apiOk += 1;
      }
    }
  }
  return nodes;
}
