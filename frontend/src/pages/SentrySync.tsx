import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Clock, CheckCircle2, XCircle, AlertTriangle, Zap } from "lucide-react";
import { clsx } from "clsx";
import { apiFetch } from "@/lib/api";
import { OutcomeBadge } from "@/components/OutcomeBadge";
import { Skeleton } from "@/components/Skeleton";

type PendingRow = {
  sentryEventId: string | null;
  service: string;
  appService: string | null;
  endpoint: string;
  requestUrl: string | null;
  outcome: "SUCCESS" | "FAILURE" | "OTHER";
  statusCode: number;
  occurredAt: string;
  sessionId: string | null;
  userEmail: string | null;
  sentryType: string | null;
};

type IngestionHealth = {
  periodHours: number;
  acceptedTotal: number;
  droppedTotal: number;
  droppedByReason: Record<string, number>;
  dropRatio: number;
  quotaExceeded: boolean;
};

type StatusRes = {
  enabled: boolean;
  lastSyncedAt: string | null;
  syncIntervalMs: number;
  nextSyncAt: string | null;
  pendingCount: number;
  pendingBreakdown: { SUCCESS: number; FAILURE: number; OTHER: number };
  pending: PendingRow[];
  ingestionHealth: IngestionHealth | null;
  fetchError?: string;
};

const REASON_LABELS: Record<string, string> = {
  error_usage_exceeded: "Plan quota exceeded",
  ratelimit_backoff: "Rate-limit backoff",
  network_error: "Network error (client-side)",
  queue_overflow: "Ingest queue overflow",
  spike_protection: "Spike protection",
  invalid: "Invalid payload",
  filtered: "Filtered by inbound rules",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function timeUntil(iso: string | null): string {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `in ${s}s`;
  return `in ${Math.floor(s / 60)}m`;
}

export function SentrySync() {
  const [status, setStatus] = useState<StatusRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<StatusRes>("/sentry-sync/status");
      setStatus(data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load Sentry sync status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  async function runSync() {
    setSyncing(true);
    setLastAction(null);
    try {
      const res = await apiFetch<{ ok: boolean; lastSyncedAt: string | null }>(
        "/sentry-sync/run",
        { method: "POST" }
      );
      setLastAction(
        res.lastSyncedAt
          ? `Synced successfully — watermark advanced to ${new Date(res.lastSyncedAt).toLocaleTimeString()}`
          : "Sync ran — no new events found"
      );
      await load();
    } catch (e) {
      setLastAction(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
            <RefreshCw className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            Sentry Sync — Real-Time Tracking
          </h1>
          <p className="text-sm text-zinc-700 dark:text-zinc-400">
            See Sentry events that haven&apos;t been pulled into the monitor yet, and trigger an
            immediate sync instead of waiting for the next scheduled run.
          </p>
        </div>
        <button
          onClick={() => void runSync()}
          disabled={syncing || (status !== null && !status.enabled)}
          className={clsx(
            "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-semibold transition",
            syncing
              ? "cursor-wait border-zinc-300 dark:border-zinc-700 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400"
              : "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25"
          )}
        >
          <RefreshCw className={clsx("h-4 w-4", syncing && "animate-spin")} />
          {syncing ? "Syncing…" : "Pull / Sync Now"}
        </button>
      </div>

      {lastAction && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/60 dark:bg-zinc-900/60 px-4 py-2 text-sm text-zinc-600 dark:text-zinc-300">
          {lastAction}
        </div>
      )}

      {err && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-700 dark:text-red-300">
          {err}
        </div>
      )}

      {status?.ingestionHealth && status.ingestionHealth.droppedTotal > 0 && (
        <div
          className={clsx(
            "rounded-2xl border p-4",
            status.ingestionHealth.quotaExceeded
              ? "border-red-500/40 bg-red-500/10"
              : "border-amber-500/30 bg-amber-500/10"
          )}
        >
          <div
            className={clsx(
              "flex items-center gap-2 text-sm font-bold",
              status.ingestionHealth.quotaExceeded ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-200"
            )}
          >
            <AlertTriangle className="h-4 w-4" />
            {status.ingestionHealth.quotaExceeded
              ? "Sentry is dropping events — plan quota likely exceeded"
              : "Sentry dropped some events recently"}
          </div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
            {status.ingestionHealth.droppedTotal.toLocaleString()} of{" "}
            {(status.ingestionHealth.acceptedTotal + status.ingestionHealth.droppedTotal).toLocaleString()}{" "}
            error-category events (
            {(status.ingestionHealth.dropRatio * 100).toFixed(1)}%) were rejected by Sentry in the
            last {status.ingestionHealth.periodHours}h — before they ever reached this dashboard.
            {status.ingestionHealth.quotaExceeded &&
              " This usually means your Sentry org's event quota has been used up. Check Sentry → Settings → Subscription/Usage & Billing."}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(status.ingestionHealth.droppedByReason)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <span
                  key={reason}
                  className="rounded-md border border-zinc-300 dark:border-zinc-700 bg-zinc-50/60 dark:bg-zinc-900/60 px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300"
                  title={reason}
                >
                  {reasonLabel(reason)}:{" "}
                  <span className="font-semibold text-zinc-900 dark:text-white">{count.toLocaleString()}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {loading && !status ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : status && !status.enabled ? (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 text-sm text-amber-700 dark:text-amber-200">
          Sentry sync is disabled — <code>SENTRY_AUTH_TOKEN</code> is not configured on the backend.
        </div>
      ) : (
        status && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/60 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-400">
                  <Clock className="h-3.5 w-3.5" /> Last Pulled
                </div>
                <div className="mt-1.5 text-xl font-bold text-zinc-900 dark:text-white">
                  {timeAgo(status.lastSyncedAt)}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
                  {status.lastSyncedAt ? new Date(status.lastSyncedAt).toLocaleString() : "—"}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/60 p-4">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-400">
                  <Zap className="h-3.5 w-3.5" /> Next Auto Sync
                </div>
                <div className="mt-1.5 text-xl font-bold text-zinc-900 dark:text-white">
                  {timeUntil(status.nextSyncAt)}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
                  Every {Math.round(status.syncIntervalMs / 1000)}s
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/60 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-400">
                  Un-pulled Events
                </div>
                <div className="mt-1.5 text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-white">
                  {status.pendingCount}
                </div>
                <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
                  Waiting in Sentry, not yet in the dashboard
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/60 dark:bg-zinc-900/60 p-4">
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-700 dark:text-zinc-400">
                  Pending Breakdown
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {status.pendingBreakdown.SUCCESS}
                  </span>
                  <span className="flex items-center gap-1 text-red-700 dark:text-red-300">
                    <XCircle className="h-3.5 w-3.5" /> {status.pendingBreakdown.FAILURE}
                  </span>
                  <span className="flex items-center gap-1 text-amber-700 dark:text-amber-200">
                    <AlertTriangle className="h-3.5 w-3.5" /> {status.pendingBreakdown.OTHER}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/40 dark:bg-zinc-900/40">
              <div className="flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-800/80 px-5 py-3">
                <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
                  Preview — un-pulled Sentry events{" "}
                  <span className="font-normal text-zinc-600 dark:text-zinc-500">
                    (showing up to {status.pending.length} of {status.pendingCount})
                  </span>
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-zinc-600 dark:text-zinc-500">
                    <tr className="border-b border-zinc-200/80 dark:border-zinc-800/80">
                      <th className="px-5 py-2 font-semibold">Occurred</th>
                      <th className="px-3 py-2 font-semibold">Service</th>
                      <th className="px-3 py-2 font-semibold">Endpoint</th>
                      <th className="px-3 py-2 font-semibold">Outcome</th>
                      <th className="px-3 py-2 font-semibold">Session</th>
                      <th className="px-3 py-2 font-semibold">User</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.pending.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-zinc-600 dark:text-zinc-500">
                          Nothing pending — the dashboard is fully up to date with Sentry.
                        </td>
                      </tr>
                    ) : (
                      status.pending.map((p, i) => (
                        <tr
                          key={p.sentryEventId ?? i}
                          className="border-b border-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50/60 dark:hover:bg-zinc-900/60"
                        >
                          <td className="whitespace-nowrap px-5 py-2 text-zinc-700 dark:text-zinc-400">
                            {new Date(p.occurredAt).toLocaleString()}
                          </td>
                          <td className="px-3 py-2">
                            <span className="rounded bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-zinc-600 dark:text-zinc-300">
                              {p.service}
                            </span>
                          </td>
                          <td className="max-w-[280px] truncate px-3 py-2 font-mono text-[11px]" title={p.requestUrl ?? p.endpoint}>
                            {p.requestUrl ?? p.endpoint}
                          </td>
                          <td className="px-3 py-2">
                            <OutcomeBadge outcome={p.outcome} />
                          </td>
                          <td className="px-3 py-2 font-mono text-[11px] text-zinc-600 dark:text-zinc-500">
                            {p.sessionId ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-zinc-700 dark:text-zinc-400">{p.userEmail ?? "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )
      )}
    </div>
  );
}
