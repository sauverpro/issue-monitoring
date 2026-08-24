import type { SessionAction } from "@/types/session";

const NETWORK_OTHER = new Set([
  "FETCH_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "PARSING_ERROR",
]);

function isApiCall(action: SessionAction): boolean {
  const t = (action.actionType ?? "").toLowerCase();
  if (t === "navigation" || t === "lifecycle" || t === "auth") return false;
  return true;
}

export function actionOutcome(
  action: SessionAction
): "success" | "failure" | "warning" {
  const kind = (action.actionType ?? "").toLowerCase();
  if (kind === "lifecycle" || kind === "navigation") return "warning";
  if (kind === "auth") return "success";

  if (!isApiCall(action)) return "warning";

  const httpRaw = (action.httpStatus ?? "").toUpperCase();
  if (NETWORK_OTHER.has(httpRaw) || (action.status ?? "").toLowerCase() === "other") {
    return "warning";
  }
  const st = (action.status ?? "").toLowerCase();
  if (st === "failure" || st === "error") return "failure";
  const t = (action.type ?? "").toLowerCase();
  if (t.includes("failure")) return "failure";
  const http = parseInt(action.httpStatus ?? "", 10);
  if (!Number.isNaN(http) && http >= 400) return "failure";
  if (st === "success") return "success";
  if (!Number.isNaN(http) && http >= 200 && http < 300) return "success";
  return "warning";
}

export function formatActionLabel(action: SessionAction): string {
  const kind = (action.actionType ?? "").toLowerCase();
  if (kind === "navigation") {
    const from = action.message?.match(/Navigation:\s*(.+)/i)?.[1];
    if (from) return from.trim();
    if (action.screen) return `Opened ${action.screen}`;
    return action.message || "Navigation";
  }
  if (kind === "lifecycle") {
    return action.message || "App lifecycle";
  }
  if (kind === "auth") {
    const role = action.role;
    const acct = action.accountType;
    const who = [role, acct].filter(Boolean).join(" / ");
    return who ? `Session bound (${who})` : action.message || "Session bound";
  }

  const method = action.method || "GET";
  let path = action.endpoint ?? "unknown";
  try {
    const u = new URL(path);
    path = u.pathname + u.search;
  } catch {
    /* keep as-is */
  }
  return `${method} ${path}`;
}

export function formatTime(ts: string): string {
  try {
    return new Date(ts).toISOString().slice(11, 19);
  } catch {
    return ts;
  }
}

export function formatDurationMs(start: string | null, end: string | null): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  return `${min}m ${sec % 60}s`;
}

export function formatLatency(ms: number | null | undefined): string | null {
  if (ms == null || Number.isNaN(ms)) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
