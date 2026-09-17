/**
 * Classify API call results for Monitor dashboards.
 *
 * Rules (status + outcome together — status 0 can be SUCCESS or FAILURE):
 * - 5xx                         → server_error
 * - 4xx                         → client_failure
 * - 2xx / 3xx                   → success
 * - status 0 + SUCCESS          → success
 * - status 0 + FAILURE          → client_failure
 * - status 0 + OTHER / missing  → network
 */

export type HttpResultClass =
  | "success"
  | "client_failure"
  | "server_error"
  | "network";

export const HTTP_RESULT_LABELS: Record<HttpResultClass, string> = {
  success: "Success",
  client_failure: "Client failure",
  server_error: "Server error (5xx)",
  network: "Network",
};

export function classifyHttpResult(
  statusCode: number | null | undefined,
  outcome?: string | null
): HttpResultClass {
  const code = statusCode == null || Number.isNaN(Number(statusCode)) ? 0 : Number(statusCode);
  const out = (outcome ?? "").toUpperCase();

  if (code >= 500) return "server_error";
  if (code >= 400 && code < 500) return "client_failure";
  if (code >= 200 && code < 400) return "success";

  // status 0 / missing — trust explicit outcome
  if (code === 0) {
    if (out === "SUCCESS") return "success";
    if (out === "FAILURE") return "client_failure";
    return "network";
  }

  if (out === "SUCCESS") return "success";
  if (out === "OTHER") return "network";
  return "client_failure";
}

/** SQL CASE matching classifyHttpResult(); uses columns status_code, outcome. */
export function httpResultClassSql(alias = ""): string {
  const p = alias ? `${alias}.` : "";
  return `CASE
    WHEN ${p}status_code >= 500 THEN 'server_error'
    WHEN ${p}status_code >= 400 AND ${p}status_code < 500 THEN 'client_failure'
    WHEN ${p}status_code >= 200 AND ${p}status_code < 400 THEN 'success'
    WHEN COALESCE(${p}status_code, 0) = 0 AND UPPER(COALESCE(${p}outcome, '')) = 'SUCCESS' THEN 'success'
    WHEN COALESCE(${p}status_code, 0) = 0 AND UPPER(COALESCE(${p}outcome, '')) = 'FAILURE' THEN 'client_failure'
    WHEN COALESCE(${p}status_code, 0) = 0 THEN 'network'
    WHEN UPPER(COALESCE(${p}outcome, '')) = 'SUCCESS' THEN 'success'
    WHEN UPPER(COALESCE(${p}outcome, '')) = 'OTHER' THEN 'network'
    ELSE 'client_failure'
  END`;
}

/** Infra-facing failures used for availability / health (5xx + network). */
export function isInfraFailure(cls: HttpResultClass): boolean {
  return cls === "server_error" || cls === "network";
}

export function apiOpsStatus(counts: {
  success: number;
  clientFailure: number;
  serverError: number;
  network: number;
}): "healthy" | "degraded" | "critical" | "idle" {
  const total =
    counts.success + counts.clientFailure + counts.serverError + counts.network;
  if (total === 0) return "idle";
  const infra = counts.serverError + counts.network;
  const infraRate = infra / total;
  if (infraRate >= 0.15 || counts.serverError >= 20) return "critical";
  if (infraRate >= 0.05 || counts.serverError >= 5) return "degraded";
  return "healthy";
}
