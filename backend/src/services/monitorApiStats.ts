import { matchUpstreamSlug, normalizeHost } from "./monitorHosts.js";

export type ApiStatRow = {
  service: string;
  host: string | null;
  total: number;
  success: number;
  failure: number;
  other: number;
  avgLatencyMs: number;
};

/** Re-label rows by project upstream host match and merge duplicates. */
export function mergeApiStatsByUpstream(
  rows: ApiStatRow[],
  upstreams: Array<{ slug: string; host: string }>
): ApiStatRow[] {
  type Acc = {
    service: string;
    host: string | null;
    total: number;
    success: number;
    failure: number;
    other: number;
    latencySum: number;
    latencyN: number;
  };
  const map = new Map<string, Acc>();

  for (const r of rows) {
    const resolved =
      (r.host ? matchUpstreamSlug(`https://${r.host}/`, upstreams) : null) ??
      r.service;
    const hostNorm = r.host ? normalizeHost(r.host) : null;
    const key = `${resolved.toUpperCase()}::${hostNorm ?? ""}`;
    const cur = map.get(key) ?? {
      service: resolved.toUpperCase(),
      host: hostNorm,
      total: 0,
      success: 0,
      failure: 0,
      other: 0,
      latencySum: 0,
      latencyN: 0,
    };
    cur.total += r.total;
    cur.success += r.success;
    cur.failure += r.failure;
    cur.other += r.other;
    if (r.avgLatencyMs > 0 && r.total > 0) {
      cur.latencySum += r.avgLatencyMs * r.total;
      cur.latencyN += r.total;
    }
    map.set(key, cur);
  }

  return [...map.values()]
    .map((a) => ({
      service: a.service,
      host: a.host,
      total: a.total,
      success: a.success,
      failure: a.failure,
      other: a.other,
      avgLatencyMs: a.latencyN > 0 ? Math.round(a.latencySum / a.latencyN) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}
