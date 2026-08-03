import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { TRACKED_UPSTREAM_APIS } from "@/lib/trackedUpstreams";
import { OutcomeBadge } from "@/components/OutcomeBadge";

type Row = {
  id: string;
  service: string;
  upstream_key: string;
  outcome: "SUCCESS" | "FAILURE" | "OTHER";
  endpoint: string;
  request_url: string | null;
  status_code: number;
  latency_ms: number;
  error_code: string | null;
  source: string;
  session_id: string | null;
  occurred_at: string;
  response_body: string | null;
};

export function Events() {
  const [items, setItems] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [service, setService] = useState<string>("");
  const [upstreamKey, setUpstreamKey] = useState("");
  const [outcome, setOutcome] = useState<string>("");
  const [endpoint, setEndpoint] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  useEffect(() => {
    const q = new URLSearchParams();
    if (service) q.set("service", service);
    if (upstreamKey.trim()) q.set("upstream_key", upstreamKey.trim().toLowerCase());
    if (outcome) q.set("outcome", outcome);
    if (endpoint) q.set("endpoint", endpoint);
    q.set("limit", String(limit));
    q.set("offset", String(offset));
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{
          items: Row[];
          total: number;
        }>(`/events?${q.toString()}`);
        if (!cancelled) {
          setItems(res.items);
          setTotal(res.total);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load events");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, upstreamKey, outcome, endpoint, offset]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Event log
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Raw events from mobile/web clients: each row includes an{" "}
          <code className="text-zinc-500">upstream_key</code> (which external API) and an{" "}
          <code className="text-zinc-500">outcome</code> (SUCCESS / FAILURE / OTHER for no HTTP
          response).
        </p>
        <details className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-sm text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300">
            Tracked upstream APIs (reference)
          </summary>
          <ul className="mt-3 space-y-2 border-t border-zinc-800/80 pt-3">
            {TRACKED_UPSTREAM_APIS.map((u) => (
              <li key={u.baseUrl} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                <span className="font-medium text-zinc-200">{u.label}</span>
                <span className="text-xs text-zinc-500">
                  {u.envHint}
                  {"typicalService" in u && u.typicalService
                    ? ` · usually ingest as ${u.typicalService}`
                    : null}
                </span>
                <a
                  href={u.baseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-emerald-400/90 hover:text-emerald-300"
                >
                  {u.baseUrl}
                  <ExternalLink className="h-3 w-3 opacity-70" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-zinc-500">
            Use <code className="text-zinc-400">service</code> (DDIN, MVEND, or KORALINK) for the product line, and
            a stable <code className="text-zinc-400">upstream_key</code> per integrated API (e.g.{" "}
            <code className="text-zinc-400">ddin_agency_verify</code>).
          </p>
        </details>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Service
          <select
            value={service}
            onChange={(e) => {
              setOffset(0);
              setService(e.target.value);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value="">All</option>
            <option value="DDIN">DDIN</option>
            <option value="MVEND">MVEND</option>
            <option value="KORALINK">KORALINK</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Upstream key
          <input
            value={upstreamKey}
            onChange={(e) => {
              setOffset(0);
              setUpstreamKey(e.target.value);
            }}
            placeholder="e.g. ddin_agency_verify"
            className="w-44 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-sm text-zinc-100"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Outcome
          <select
            value={outcome}
            onChange={(e) => {
              setOffset(0);
              setOutcome(e.target.value);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value="">All</option>
            <option value="SUCCESS">SUCCESS</option>
            <option value="FAILURE">FAILURE</option>
            <option value="OTHER">OTHER</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Path / URL contains
          <input
            value={endpoint}
            onChange={(e) => {
              setOffset(0);
              setEndpoint(e.target.value);
            }}
            placeholder="path or host…"
            className="w-48 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          />
        </label>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="min-w-full text-left text-xs sm:text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-950/50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="whitespace-nowrap px-3 py-2">Time (UTC)</th>
              <th className="px-3 py-2">Service</th>
              <th className="min-w-[120px] px-3 py-2">Upstream</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="min-w-[140px] px-3 py-2">Path</th>
              <th className="min-w-[180px] px-3 py-2">Request URL</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Latency</th>
              <th className="px-3 py-2">Source</th>
              <th className="min-w-[120px] px-3 py-2">Response</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-zinc-500">
                  No events in this window.
                </td>
              </tr>
            ) : (
              items.map((r) => (
                <tr key={r.id} className="align-top font-mono hover:bg-zinc-900/40">
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-400">
                    {new Date(r.occurred_at).toISOString()}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">{r.service}</td>
                  <td className="max-w-[140px] truncate px-3 py-2 text-cyan-400/90" title={r.upstream_key}>
                    {r.upstream_key}
                  </td>
                  <td className="px-3 py-2">
                    <OutcomeBadge outcome={r.outcome} />
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-emerald-400/90" title={r.endpoint}>
                    {r.endpoint}
                  </td>
                  <td
                    className="max-w-[280px] truncate px-3 py-2 text-cyan-400/90"
                    title={r.request_url ?? undefined}
                  >
                    {r.request_url ?? "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-300">
                    {r.status_code}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                    {r.latency_ms} ms
                  </td>
                  <td className="px-3 py-2 text-zinc-500">{r.source}</td>
                  <td className="max-w-[200px] px-3 py-2 text-zinc-400">
                    {r.response_body ? (
                      <details className="cursor-pointer">
                        <summary className="text-emerald-400/90 hover:text-emerald-300">
                          View body
                        </summary>
                        <pre className="mt-2 max-h-64 max-w-xl overflow-auto whitespace-pre-wrap break-all rounded-md border border-zinc-800 bg-zinc-950 p-2 text-[11px] leading-relaxed text-zinc-300">
                          {tryFormatJson(r.response_body)}
                        </pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          Showing {items.length} of {total}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - limit))}
            className="rounded-md border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={offset + limit >= total}
            onClick={() => setOffset((o) => o + limit)}
            className="rounded-md border border-zinc-800 px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function tryFormatJson(s: string): string {
  try {
    const v = JSON.parse(s) as unknown;
    return JSON.stringify(v, null, 2);
  } catch {
    return s;
  }
}
