import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { apiFetch } from "@/lib/api";

type SessionRow = {
  session_id: string;
  started_at: string;
  ended_at: string;
  last_action_index: number | null;
  user_id: string | null;
  user_email: string | null;
  role: string | null;
  account_type: string | null;
  total_events: number;
  failure_events: number;
  distinct_endpoints: number;
};

const WINDOWS = [
  { id: "1h", label: "1h" },
  { id: "6h", label: "6h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
] as const;

export function Sessions() {
  const [items, setItems] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [windowId, setWindowId] =
    useState<(typeof WINDOWS)[number]["id"]>("24h");
  const [hasFailures, setHasFailures] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [appService, setAppService] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;

  useEffect(() => {
    const q = new URLSearchParams();
    q.set("window", windowId);
    if (hasFailures) q.set("has_failures", "true");
    if (userEmail.trim()) q.set("user_email", userEmail.trim());
    if (appService) q.set("app_service", appService);
    q.set("limit", String(limit));
    q.set("offset", String(offset));
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{
          items: SessionRow[];
          total: number;
        }>(`/sessions?${q.toString()}`);
        if (!cancelled) {
          setItems(res.items);
          setTotal(res.total);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load sessions");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [windowId, hasFailures, userEmail, appService, offset]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Sessions
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          User journeys from Sentry mobile telemetry, grouped by{" "}
          <code className="text-zinc-500">session_id</code>.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          Window
          <select
            value={windowId}
            onChange={(e) => {
              setOffset(0);
              setWindowId(e.target.value as typeof windowId);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          >
            {WINDOWS.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          <input
            type="checkbox"
            checked={hasFailures}
            onChange={(e) => {
              setOffset(0);
              setHasFailures(e.target.checked);
            }}
            className="rounded border-zinc-700"
          />
          Failures only
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          User email
          <input
            value={userEmail}
            onChange={(e) => {
              setOffset(0);
              setUserEmail(e.target.value);
            }}
            placeholder="filter by email…"
            className="w-48 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-500">
          App service
          <select
            value={appService}
            onChange={(e) => {
              setOffset(0);
              setAppService(e.target.value);
            }}
            className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100"
          >
            <option value="">All</option>
            <option value="auth">auth</option>
            <option value="marketplace">marketplace</option>
            <option value="gwiza">gwiza</option>
            <option value="ddin_digital_services">ddin_digital_services</option>
            <option value="integra_phones">integra_phones</option>
          </select>
        </label>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-950/50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Session</th>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2 text-right">Calls</th>
              <th className="px-3 py-2 text-right">Failures</th>
              <th className="px-3 py-2 text-right">Endpoints</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {loading ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-zinc-500">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-zinc-500">
                  No sessions in this window.
                </td>
              </tr>
            ) : (
              items.map((s) => {
                const durationMs =
                  new Date(s.ended_at).getTime() -
                  new Date(s.started_at).getTime();
                return (
                  <tr key={s.session_id} className="hover:bg-zinc-900/40">
                    <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-zinc-300">
                      {s.session_id}
                    </td>
                    <td className="px-3 py-2 text-zinc-300">
                      {s.user_email ?? s.user_id ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-500">
                      {s.role ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-400">
                      {new Date(s.started_at).toISOString()}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">
                      {formatDuration(durationMs)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-300">
                      {s.total_events}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        s.failure_events > 0 ? "text-red-300" : "text-zinc-500"
                      }`}
                    >
                      {s.failure_events}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-zinc-400">
                      {s.distinct_endpoints}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/sessions/${encodeURIComponent(s.session_id)}`}
                        className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                      >
                        View
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                );
              })
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
