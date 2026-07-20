import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ActionTimeline } from "@/components/ActionTimeline";
import { formatDurationMs } from "@/lib/sessionUtils";
import type { SentryIssueDetail } from "@/types/session";

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-zinc-100">
        {value}
      </p>
    </div>
  );
}

export function MonitoringIssueDetail() {
  const { issueId } = useParams<{ issueId: string }>();
  const [issue, setIssue] = useState<SentryIssueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!issueId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<SentryIssueDetail>(
          `/issues/${encodeURIComponent(issueId)}`
        );
        if (!cancelled) {
          setIssue(res);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load issue");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [issueId]);

  if (loading) return <p className="text-zinc-500">Loading issue…</p>;

  if (err || !issue) {
    return (
      <div className="space-y-4">
        <Link
          to="/monitoring/issues"
          className="inline-flex items-center gap-1 text-sm text-emerald-400"
        >
          <ArrowLeft className="h-4 w-4" />
          Issues
        </Link>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err?.includes("404") || err?.toLowerCase().includes("not found")
            ? "This issue is no longer available in Sentry (it may have been resolved or deleted). Go back to the list and pick a current issue."
            : err}
        </div>
      </div>
    );
  }

  const session = issue.session;
  const summary = session?.summary;

  return (
    <div className="space-y-8">
      <Link
        to="/monitoring/issues"
        className="inline-flex items-center gap-1 text-sm text-emerald-400 hover:text-emerald-300"
      >
        <ArrowLeft className="h-4 w-4" />
        Issues
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">{issue.title}</h1>
          <p className="mt-2 text-sm text-zinc-400">
            {issue.level} · {issue.status} · {issue.count} events ·{" "}
            {issue.userCount} users affected
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            First seen {new Date(issue.firstSeen).toISOString()} · Last seen{" "}
            {new Date(issue.lastSeen).toISOString()}
          </p>
        </div>
        <a
          href={issue.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
        >
          Open in Sentry
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>

      {issue.relatedSessionId && session ? (
        <>
          <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-emerald-300">
                  Affected session
                </h2>
                <p className="mt-1 font-mono text-sm text-zinc-200">
                  {issue.relatedSessionId}
                </p>
                {session.user.email && (
                  <p className="mt-1 text-xs text-zinc-400">
                    {session.user.email}
                    {session.user.role ? ` · ${session.user.role}` : ""}
                  </p>
                )}
              </div>
              <Link
                to={`/monitoring/sessions/${encodeURIComponent(issue.relatedSessionId)}`}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-500/20"
              >
                Full session timeline
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {summary && (
              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                <StatCard label="Actions" value={summary.totalActions} />
                <StatCard label="Success" value={summary.successfulActions} />
                <StatCard label="Failed" value={summary.failedActions} />
                <StatCard
                  label="Error rate"
                  value={`${(summary.errorRate * 100).toFixed(0)}%`}
                />
                <StatCard
                  label="Duration"
                  value={formatDurationMs(summary.startedAt, summary.endedAt)}
                />
              </dl>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-medium text-zinc-400">
              User action timeline (before / around this error)
            </h2>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-4">
              <ActionTimeline actions={session.actions} />
            </div>
          </section>
        </>
      ) : issue.relatedSessionId ? (
        <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <h2 className="text-sm font-medium text-emerald-300">Affected session</h2>
          <p className="mt-1 font-mono text-sm text-zinc-200">
            {issue.relatedSessionId}
          </p>
          <Link
            to={`/monitoring/sessions/${encodeURIComponent(issue.relatedSessionId)}`}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-emerald-400 hover:text-emerald-300"
          >
            View session timeline
          </Link>
        </section>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-800 px-4 py-6 text-center text-sm text-zinc-500">
          No matching session found near this error. Telemetry{" "}
          <code className="text-zinc-400">captureMessage</code> events with{" "}
          <code className="text-zinc-400">session_id</code> may not overlap this
          issue&apos;s timestamp — check Sessions or Event log for the same time
          window ({new Date(issue.lastSeen).toISOString()}).
        </p>
      )}
    </div>
  );
}
