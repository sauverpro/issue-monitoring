import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/lib/api";
import { Skeleton } from "@/components/Skeleton";
import { ArrowRight } from "lucide-react";

type IncidentRow = {
  id: string;
  service: string;
  severity: string;
  status: string;
  opened_at: string;
  title: string;
};

export function Incidents() {
  const [items, setItems] = useState<IncidentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ incidents: IncidentRow[] }>(
          "/incidents?scope=recent"
        );
        if (!cancelled) setItems(res.incidents);
      } catch (e) {
        if (!cancelled)
          setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Incidents
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Auto-opened when rolling error rates cross thresholds; add notes and
          resolve manually when appropriate.
        </p>
      </div>
      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {err}
        </div>
      )}
      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/30">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-800 bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Severity</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Opened</th>
                <th className="w-10 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {items.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-zinc-500"
                  >
                    No incidents recorded yet.
                  </td>
                </tr>
              ) : (
                items.map((i) => (
                  <tr key={i.id} className="hover:bg-zinc-900/50">
                    <td className="max-w-md px-4 py-3 font-medium text-zinc-100">
                      {i.title}
                    </td>
                    <td className="px-4 py-3 text-zinc-400">{i.service}</td>
                    <td className="px-4 py-3 text-zinc-400">{i.severity}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">
                        {i.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 tabular-nums">
                      {new Date(i.opened_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        to={`/incidents/${i.id}`}
                        className="inline-flex text-emerald-400 hover:text-emerald-300"
                        aria-label={`Open incident ${i.id}`}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
