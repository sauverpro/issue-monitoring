import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { EmptyState, PageHeader, Panel } from "@/org/components/ui";

type Payload = {
  upstreams: { id: string; slug: string; host: string; label: string }[];
  stats: {
    service: string;
    host: string | null;
    total: number;
    success: number;
    failure: number;
    other: number;
    avgLatencyMs: number;
  }[];
};

export function ApisPage() {
  const { projectId } = useParams();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<Payload>(`/console/projects/${projectId}/apis`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  return (
    <div>
      <PageHeader
        eyebrow="Project"
        title="API Monitor"
        description={
          data.upstreams.length
            ? `Labeled hosts: ${data.upstreams.map((u) => u.host).join(", ")}`
            : "Hosts in Settings label Overview/APIs. All captured HTTP still appears here."
        }
      />
      <Panel>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-5 py-2">Service</th>
              <th className="px-5 py-2">Host</th>
              <th className="px-5 py-2">Success</th>
              <th className="px-5 py-2">Failure</th>
              <th className="px-5 py-2">Other</th>
              <th className="px-5 py-2">Avg ms</th>
            </tr>
          </thead>
          <tbody>
            {data.stats.map((r, i) => (
              <tr key={`${r.service}-${i}`} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-5 py-3 font-medium">{r.service}</td>
                <td className="px-5 py-3 font-mono text-xs">{r.host ?? "—"}</td>
                <td className="px-5 py-3 tabular-nums text-emerald-700 dark:text-emerald-400">{r.success}</td>
                <td className="px-5 py-3 tabular-nums text-red-600">{r.failure}</td>
                <td className="px-5 py-3 tabular-nums text-amber-600">{r.other}</td>
                <td className="px-5 py-3 tabular-nums">{r.avgLatencyMs}</td>
              </tr>
            ))}
            {data.stats.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState title="No API calls yet" body="Traffic to allowed hosts will appear here." />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
