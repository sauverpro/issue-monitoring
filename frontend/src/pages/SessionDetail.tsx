import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { OutcomeBadge } from "@/components/OutcomeBadge";

type SessionSummary = {
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

type TimelineRow = {
  id: string;
  service: string;
  app_service: string | null;
  upstream_key: string;
  endpoint: string;
  request_url: string | null;
  status_code: number;
  outcome: "SUCCESS" | "FAILURE" | "OTHER";
  action_index: number | null;
  sentry_type: string | null;
  failure_reason: string | null;
  user_email: string | null;
  occurred_at: string;
  sentry_event_id: string | null;
};

export function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<SessionSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{
          session: SessionSummary;
          timeline: TimelineRow[];
        }>(`/sessions/${encodeURIComponent(id)}`);
        if (!cancelled) {
          setSession(res.session);
          setTimeline(res.timeline);
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
  }, [id]);

  if (loading) {
    return <p className="text-zinc-600 dark:text-zinc-500">Loading session…</p>;
  }

  if (err || !session) {
    return (
      <div className="space-y-4">
        <Link
          to="/sessions"
          className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to sessions
        </Link>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          {err ?? "Session not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/sessions"
          className="mb-4 inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Sessions
        </Link>
        <h1 className="font-mono text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
          {session.session_id}
        </h1>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-700 dark:text-zinc-400">
          <span>
            User:{" "}
            <span className="text-zinc-700 dark:text-zinc-200">
              {session.user_email ?? session.user_id ?? "—"}
            </span>
          </span>
          {session.role && (
            <span>
              Role: <span className="text-zinc-700 dark:text-zinc-200">{session.role}</span>
            </span>
          )}
          {session.account_type && (
            <span>
              Account:{" "}
              <span className="text-zinc-700 dark:text-zinc-200">{session.account_type}</span>
            </span>
          )}
          <span>
            {session.total_events} calls ·{" "}
            <span
              className={
                session.failure_events > 0 ? "text-red-700 dark:text-red-300" : "text-zinc-600 dark:text-zinc-300"
              }
            >
              {session.failure_events} failures
            </span>{" "}
            · {session.distinct_endpoints} endpoints
          </span>
        </div>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
          {new Date(session.started_at).toISOString()} →{" "}
          {new Date(session.ended_at).toISOString()}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 text-[11px] uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Service</th>
              <th className="min-w-[200px] px-3 py-2">Endpoint</th>
              <th className="px-3 py-2">Failure reason</th>
              <th className="px-3 py-2">Sentry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {timeline.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-zinc-600 dark:text-zinc-500">
                  No events for this session.
                </td>
              </tr>
            ) : (
              timeline.map((row) => (
                <tr key={row.id} className="align-top font-mono text-xs hover:bg-zinc-50/40 dark:hover:bg-zinc-900/40">
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-500">
                    {row.action_index ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-zinc-700 dark:text-zinc-400">
                    {new Date(row.occurred_at).toISOString()}
                  </td>
                  <td className="px-3 py-2">
                    <OutcomeBadge outcome={row.outcome} />
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-300">
                    {row.status_code || "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-700 dark:text-zinc-400">
                    {row.app_service ?? row.service}
                  </td>
                  <td
                    className="max-w-[320px] truncate px-3 py-2 text-emerald-600/90 dark:text-emerald-400/90"
                    title={row.request_url ?? row.endpoint}
                  >
                    {row.request_url ?? row.endpoint}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-red-700/80 dark:text-red-300/80">
                    {row.failure_reason ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">
                    {row.sentry_event_id
                      ? row.sentry_event_id.slice(0, 8)
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
