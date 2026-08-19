import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api";

type EndpointRow = {
  endpoint_key: string;
  request_url: string;
  endpoint: string;
  app_service: string | null;
  success_count: number;
  failure_count: number;
  other_count: number;
  total_count: number;
  success_rate: number;
  unique_users: number;
  unique_sessions: number;
  last_failure_at: string | null;
};

const WINDOWS = [
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
] as const;

export function Endpoints() {
  const [endpoints, setEndpoints] = useState<EndpointRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [windowId, setWindowId] =
    useState<(typeof WINDOWS)[number]["id"]>("24h");
  const [appService, setAppService] = useState("");

  useEffect(() => {
    const q = new URLSearchParams();
    q.set("window", windowId);
    if (appService) q.set("app_service", appService);
    q.set("limit", "100");
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ endpoints: EndpointRow[] }>(
          `/endpoints/metrics?${q.toString()}`
        );
        if (!cancelled) {
          setEndpoints(res.endpoints);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load endpoints");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowId, appService]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          Endpoints
        </h1>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-400">
          Per-endpoint success and failure rates with user impact from Sentry
          mobile telemetry.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-500">
          Window
          <select
            value={windowId}
            onChange={(e) =>
              setWindowId(e.target.value as typeof windowId)
            }
            className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-800 dark:text-zinc-100"
          >
            {WINDOWS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-500">
          App service
          <select
            value={appService}
            onChange={(e) => setAppService(e.target.value)}
            className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 px-2 py-1.5 text-sm text-zinc-800 dark:text-zinc-100"
          >
            <option value="">All</option>
            <option value="auth">auth</option>
            <option value="marketplace">marketplace</option>
            <option value="gwiza">gwiza</option>
            <option value="ddin_digital_services">ddin_digital_services</option>
            <option value="djyh">djyh</option>
            <option value="integra_phones">integra_phones</option>
            <option value="resolveit">resolveit</option>
          </select>
        </label>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 text-[11px] uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            <tr>
              <th className="min-w-[240px] px-3 py-2">Endpoint</th>
              <th className="px-3 py-2">Service</th>
              <th className="px-3 py-2 text-right">Success %</th>
              <th className="px-3 py-2 text-right">Success</th>
              <th className="px-3 py-2 text-right">Failure</th>
              <th className="px-3 py-2 text-right">Other</th>
              <th className="px-3 py-2 text-right">Users</th>
              <th className="px-3 py-2 text-right">Sessions</th>
              <th className="px-3 py-2">Last failure</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-600 dark:text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : endpoints.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-zinc-600 dark:text-zinc-500">
                  No endpoint data in this window.
                </td>
              </tr>
            ) : (
              endpoints.map((ep) => (
                <tr key={ep.endpoint_key} className="hover:bg-zinc-50/40 dark:hover:bg-zinc-900/40">
                  <td
                    className="max-w-[360px] truncate px-3 py-2 font-mono text-xs text-emerald-600/90 dark:text-emerald-400/90"
                    title={ep.request_url}
                  >
                    {ep.request_url}
                  </td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-400">
                    {ep.app_service ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                    {(ep.success_rate * 100).toFixed(1)}%
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600/80 dark:text-emerald-400/80">
                    {ep.success_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-red-700 dark:text-red-300">
                    {ep.failure_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-amber-700/80 dark:text-amber-300/80">
                    {ep.other_count}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                    {ep.unique_users}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-700 dark:text-zinc-400">
                    {ep.unique_sessions}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-600 dark:text-zinc-500">
                    {ep.last_failure_at
                      ? new Date(ep.last_failure_at).toISOString()
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-600 dark:text-zinc-500">
        Drill into failures from the{" "}
        <Link to="/events?outcome=FAILURE" className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300">
          event log
        </Link>{" "}
        or open a session from the{" "}
        <Link to="/sessions?has_failures=true" className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300">
          sessions list
          <ArrowRight className="h-3 w-3" />
        </Link>
        .
      </p>
    </div>
  );
}
