import type { SessionAction } from "@/types/session";

export function actionOutcome(
  action: SessionAction
): "success" | "failure" | "warning" {
  const st = (action.status ?? "").toLowerCase();
  if (st === "failure" || st === "error") return "failure";
  const t = (action.type ?? "").toLowerCase();
  if (t.includes("failure")) return "failure";
  const http = parseInt(action.httpStatus ?? "", 10);
  if (!Number.isNaN(http) && http >= 400) return "failure";
  if (
    action.httpStatus &&
    ["PARSING_ERROR", "NETWORK_ERROR", "TIMEOUT"].includes(
      action.httpStatus.toUpperCase()
    )
  ) {
    return "failure";
  }
  if (st === "success") return "success";
  if (!Number.isNaN(http) && http >= 200 && http < 300) return "success";
  return "warning";
}

export function formatActionLabel(action: SessionAction): string {
  const method = action.method ?? "GET";
  let path = action.endpoint ?? "unknown";
  try {
    path = new URL(path).pathname;
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
