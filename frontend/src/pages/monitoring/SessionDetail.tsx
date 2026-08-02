import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ActionTimeline } from "@/components/ActionTimeline";
import { formatDurationMs } from "@/lib/sessionUtils";
import type {
  SessionAction,
  SessionFailure,
  SessionSummary,
  SessionUser,
} from "@/types/session";

type ActionsResponse = {
  sessionId: string;
  user: SessionUser;
  summary: SessionSummary;
  actions: SessionAction[];
};

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
        {value}
      </p>
    </div>
  );
}

export function MonitoringSessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [data, setData] = useState<ActionsResponse | null>(null);
  const [failures, setFailures] = useState<SessionFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [actionsRes, failuresRes] = await Promise.all([
          apiFetch<ActionsResponse>(
            `/sessions/${encodeURIComponent(sessionId)}/actions`
          ),
          apiFetch<{ failures: SessionFailure[] }>(
            `/sessions/${encodeURIComponent(sessionId)}/failures`
          ),
        ]);
        if (!cancelled) {
          setData(actionsRes);
          setFailures(failuresRes.failures);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load session");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) return <p className="text-zinc-500">Loading session…</p>;

  if (err || !data) {
    return (
      <div className="space-y-4">
        <Link
          to="/monitoring/sessions"
          className="inline-flex items-center gap-1 text-sm text-emerald-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Sessions
        </Link>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err ?? "Session not found"}
        </div>
      </div>
    );
  }

  const { user, summary } = data;

  return (
    <div className="space-y-8">
      <div>
        <Link
          to="/monitoring/sessions"
          className="mb-4 inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Sessions
        </Link>
        <h1 className="font-mono text-xl font-semibold text-white">
          {data.sessionId}
        </h1>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Session overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="Total actions" value={summary.totalActions} />
          <StatCard label="Successful" value={summary.successfulActions} />
          <StatCard label="Failed" value={summary.failedActions} />
          <StatCard
            label="Error rate"
            value={`${(summary.errorRate * 100).toFixed(1)}%`}
          />
          <StatCard
            label="Duration"
            value={formatDurationMs(summary.startedAt, summary.endedAt)}
          />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/30 p-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">User information</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-zinc-500">User ID</dt>
            <dd className="text-zinc-200">{user.id ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Email</dt>
            <dd className="text-zinc-200">{user.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Role</dt>
            <dd className="text-zinc-200">{user.role ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-zinc-500">Account type</dt>
            <dd className="text-zinc-200">{user.accountType ?? "—"}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-zinc-400">Action timeline</h2>
        <ActionTimeline actions={data.actions} />
      </section>

      {failures.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Failure analysis
          </h2>
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-[11px] uppercase text-zinc-500">
                <tr>
                  <th className="px-3 py-2">Endpoint</th>
                  <th className="px-3 py-2">Service</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Failure reason</th>
                  <th className="px-3 py-2">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {failures.map((f, i) => (
                  <tr key={`${f.actionIndex}-${i}`} className="text-xs">
                    <td className="max-w-xs truncate px-3 py-2 font-mono text-red-300/90">
                      {f.endpoint ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{f.service ?? "—"}</td>
                    <td className="px-3 py-2">{f.httpStatus ?? "—"}</td>
                    <td className="px-3 py-2 text-red-200/80">
                      {f.failureReason ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-500">
                      {new Date(f.timestamp).toISOString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
