import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ExternalLink } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { SentryIssue } from "@/types/session";

export function MonitoringIssues() {
  const [issues, setIssues] = useState<SentryIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch<{ issues: SentryIssue[]; hasMore: boolean }>(
          `/issues?page=${page}&limit=20`
        );
        if (!cancelled) {
          setIssues(res.issues);
          setHasMore(res.hasMore);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load issues");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">Issues</h1>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-400">
          Unresolved Sentry issues with session correlation when available.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          {err}
        </div>
      )}

      <ul className="divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
        {loading ? (
          <li className="px-4 py-8 text-center text-zinc-600 dark:text-zinc-500">Loading…</li>
        ) : issues.length === 0 ? (
          <li className="px-4 py-8 text-center text-zinc-600 dark:text-zinc-500">No issues found.</li>
        ) : (
          issues.map((issue) => (
            <li key={issue.id}>
              <div className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/monitoring/issues/${issue.id}`}
                    className="text-sm font-medium text-zinc-800 dark:text-zinc-100 hover:text-emerald-700 dark:hover:text-emerald-300"
                  >
                    {issue.title}
                  </Link>
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                    {issue.level} · {issue.count} events · {issue.userCount} users ·
                    last seen {new Date(issue.lastSeen).toISOString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={issue.permalink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-600 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300"
                    title="Open in Sentry"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <Link
                    to={`/monitoring/issues/${issue.id}`}
                    className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                  >
                    View
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      <div className="flex justify-between text-sm text-zinc-600 dark:text-zinc-500">
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          disabled={!hasMore}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
