import type {
  SessionAction,
  SessionSummary,
  SessionFailure,
} from "../types/sessionInvestigation.js";

const NETWORK_OTHER = new Set([
  "FETCH_ERROR",
  "NETWORK_ERROR",
  "TIMEOUT",
  "PARSING_ERROR",
]);

export function isApiCall(action: SessionAction): boolean {
  const t = (action.actionType ?? "").toLowerCase();
  if (t === "navigation" || t === "lifecycle" || t === "auth") return false;
  if (t === "api_call" || t.includes("api") || t.includes("payment")) return true;
  if (!t) {
    return Boolean(action.endpoint || action.httpStatus || action.method);
  }
  return false;
}

function isFailure(action: SessionAction): boolean {
  if (!isApiCall(action)) return false;
  const httpRaw = (action.httpStatus ?? "").toUpperCase();
  if (NETWORK_OTHER.has(httpRaw)) return false;
  const st = (action.status ?? "").toLowerCase();
  if (st === "other") return false;
  if (st === "failure" || st === "error") return true;
  const t = (action.type ?? "").toLowerCase();
  if (t.includes("failure") && !NETWORK_OTHER.has(httpRaw)) return true;
  const http = parseInt(action.httpStatus ?? "", 10);
  if (!Number.isNaN(http) && http >= 400) return true;
  return false;
}

function isSuccess(action: SessionAction): boolean {
  if (!isApiCall(action)) return false;
  const st = (action.status ?? "").toLowerCase();
  if (st === "success") return true;
  const http = parseInt(action.httpStatus ?? "", 10);
  if (!Number.isNaN(http) && http >= 200 && http < 300) return true;
  return false;
}

export function buildSessionSummary(actions: SessionAction[]): SessionSummary {
  const api = actions.filter(isApiCall);
  const successfulActions = api.filter(isSuccess).length;
  const failedActions = api.filter(isFailure).length;
  const apiCalls = api.length;
  const totalActions = actions.length;
  const timestamps = actions
    .map((a) => a.timestamp)
    .filter(Boolean)
    .sort();

  return {
    totalActions,
    successfulActions,
    failedActions,
    apiCalls,
    errorRate: apiCalls > 0 ? failedActions / apiCalls : 0,
    startedAt: timestamps[0] ?? null,
    endedAt: timestamps[timestamps.length - 1] ?? null,
  };
}

export function extractFailures(actions: SessionAction[]): SessionFailure[] {
  return actions
    .filter(isFailure)
    .map((a) => ({
      endpoint: a.endpoint,
      service: a.service,
      failureReason: a.failureReason,
      httpStatus: a.httpStatus,
      timestamp: a.timestamp,
      actionIndex: a.actionIndex,
    }));
}

export function actionOutcome(
  action: SessionAction
): "success" | "failure" | "warning" {
  if (isFailure(action)) return "failure";
  if (isSuccess(action)) return "success";
  return "warning";
}
