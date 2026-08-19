import { OutcomeBadge, type CallOutcome } from "./OutcomeBadge";
import { StatusBadge, type ServiceStatus } from "./StatusBadge";

export type UpstreamHealthRow = {
  service: string;
  upstream_key: string;
  status: ServiceStatus;
  error_rate_5m: number;
  last_seen: string | null;
  last_outcome: CallOutcome | null;
};

export function IntegratedApisPanel({
  rows,
  loading,
}: {
  rows: UpstreamHealthRow[];
  loading: boolean;
}) {
  const sorted = [...rows].sort((a, b) =>
    a.service === b.service
      ? a.upstream_key.localeCompare(b.upstream_key)
      : a.service.localeCompare(b.service)
  );

  if (loading && rows.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30 p-6">
        <div className="h-4 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-4 h-32 animate-pulse rounded-lg bg-zinc-50/60 dark:bg-zinc-900/60" />
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 bg-zinc-50/20 dark:bg-zinc-900/20 px-4 py-6">
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-400">Integrated APIs</h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-500">
          No upstream keys registered yet. Send <code className="text-zinc-700 dark:text-zinc-400">upstream_key</code>{" "}
          on each <code className="text-zinc-700 dark:text-zinc-400">POST /events</code> payload (one stable id per
          external API you call).
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-400">Integrated APIs</h2>
        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
          Per-integration rolling health (5m window) and the result of the last reported call.
          <span className="text-zinc-600"> · </span>
          <span className="text-zinc-600 dark:text-zinc-500">
            <OutcomeBadge outcome="SUCCESS" className="align-middle" />{" "}
            <OutcomeBadge outcome="FAILURE" className="align-middle" />{" "}
            <OutcomeBadge outcome="OTHER" className="align-middle" /> — use{" "}
            <code className="text-zinc-700 dark:text-zinc-400">status_code: 0</code> or{" "}
            <code className="text-zinc-700 dark:text-zinc-400">outcome: &quot;OTHER&quot;</code> when the server never
            responded.
          </span>
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
        <table className="min-w-full text-left text-xs sm:text-sm">
          <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 text-[11px] uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
            <tr>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Upstream key</th>
              <th className="px-3 py-2">Health</th>
              <th className="px-3 py-2 text-right">5m error rate</th>
              <th className="px-3 py-2">Last call</th>
              <th className="px-3 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sorted.map((r) => (
              <tr
                key={`${r.service}:${r.upstream_key}`}
                className="hover:bg-zinc-50/40 dark:hover:bg-zinc-900/40"
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-medium text-zinc-600 dark:text-zinc-300">
                  {r.service}
                </td>
                <td className="max-w-[220px] px-3 py-2.5 font-mono text-emerald-600/90 dark:text-emerald-400/90">
                  <span className="truncate" title={r.upstream_key}>
                    {r.upstream_key}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                  {(r.error_rate_5m * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2.5">
                  <OutcomeBadge outcome={r.last_outcome} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-zinc-600 dark:text-zinc-500">
                  {r.last_seen
                    ? new Date(r.last_seen).toLocaleString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
