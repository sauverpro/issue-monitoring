import { ExternalLink } from "lucide-react";
import { OutcomeBadge, type CallOutcome } from "./OutcomeBadge";
import { StatusBadge, type ServiceStatus } from "./StatusBadge";

export type TrackedApiHealthRow = {
  id: string;
  label: string;
  base_url: string;
  status: ServiceStatus;
  error_rate_5m: number;
  last_seen: string | null;
  last_outcome: CallOutcome | null;
};

export function TrackedApisPanel({
  rows,
  loading,
}: {
  rows: TrackedApiHealthRow[];
  loading: boolean;
}) {
  if (loading && rows.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-6">
        <div className="h-4 w-56 animate-pulse rounded bg-zinc-800" />
        <div className="mt-4 h-40 animate-pulse rounded-lg bg-zinc-900/60" />
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-zinc-400">External APIs (reference)</h2>
        <p className="mt-1 text-xs text-zinc-500">
          The four upstreams from your environment reference. Metrics include events where{" "}
          <code className="text-zinc-400">upstream_key</code> matches the row id{" "}
          <span className="text-zinc-600">or</span> <code className="text-zinc-400">request_url</code>{" "}
          contains that API&apos;s host. Override base URLs with{" "}
          <code className="text-zinc-400">TRACKED_*_URL</code> in <code className="text-zinc-400">.env</code>.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/30">
        <table className="min-w-full text-left text-xs sm:text-sm">
          <thead className="border-b border-zinc-800 bg-zinc-950/50 text-[11px] uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">API</th>
              <th className="min-w-[200px] px-3 py-2">Base URL</th>
              <th className="px-3 py-2">Health</th>
              <th className="px-3 py-2 text-right">5m error rate</th>
              <th className="px-3 py-2">Last call</th>
              <th className="px-3 py-2">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-900/40">
                <td className="px-3 py-2.5">
                  <div className="font-medium text-zinc-200">{r.label}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-zinc-500">{r.id}</div>
                </td>
                <td className="max-w-[280px] px-3 py-2.5">
                  <a
                    href={r.base_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 break-all text-cyan-400/90 hover:text-cyan-300"
                  >
                    {r.base_url}
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  </a>
                </td>
                <td className="px-3 py-2.5">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-300">
                  {(r.error_rate_5m * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2.5">
                  <OutcomeBadge outcome={r.last_outcome} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">
                  {r.last_seen ? new Date(r.last_seen).toLocaleString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
