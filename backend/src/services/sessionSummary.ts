import type {
  SessionAction,
  SessionSummary,
  SessionFailure,
} from "../types/sessionInvestigation.js";

function isFailure(action: SessionAction): boolean {
  const st = (action.status ?? "").toLowerCase();
  if (st === "failure" || st === "error") return true;
  const t = (action.type ?? "").toLowerCase();
  if (t.includes("failure")) return true;
  const http = parseInt(action.httpStatus ?? "", 10);
  if (!Number.isNaN(http) && http >= 400) return true;
  if (
    action.httpStatus &&
    ["PARSING_ERROR", "NETWORK_ERROR", "TIMEOUT"].includes(
      action.httpStatus.toUpperCase()
    )
  ) {
    return true;
  }
  return false;
}

function isSuccess(action: SessionAction): boolean {
  const st = (action.status ?? "").toLowerCase();
  if (st === "success") return true;
  const http = parseInt(action.httpStatus ?? "", 10);
  if (!Number.isNaN(http) && http >= 200 && http < 300) return true;
  return false;
}

export function buildSessionSummary(actions: SessionAction[]): SessionSummary {
  const successfulActions = actions.filter(isSuccess).length;
  const failedActions = actions.filter(isFailure).length;
  const apiCalls = actions.filter(
    (a) => (a.actionType ?? "").toLowerCase() === "api_call"
  ).length;
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
    errorRate: totalActions > 0 ? failedActions / totalActions : 0,
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
