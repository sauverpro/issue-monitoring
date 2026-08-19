import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { Skeleton } from "@/components/Skeleton";
import { clsx } from "clsx";

type MonthlyUptime = {
  service: string;
  month: string;
  uptimePct: number;
  downtimeSeconds: number;
  totalSeconds: number;
};

function pctClass(pct: number): string {
  if (pct >= 0.999) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 0.99) return "text-amber-700 dark:text-amber-300";
  return "text-red-600 dark:text-red-400";
}

export function UptimePage() {
  const [rows, setRows] = useState<MonthlyUptime[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<{ months: MonthlyUptime[] }>("/uptime?months=6");
        if (!cancelled) setRows(res.months);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const services = [...new Set(rows.map((r) => r.service))];
  const months = [...new Set(rows.map((r) => r.month))].sort();
  const currentMonth = months[months.length - 1];

  function cell(service: string, month: string): MonthlyUptime | undefined {
    return rows.find((r) => r.service === service && r.month === month);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">Uptime / SLA</h1>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-400">
          Monthly uptime derived from incident open/resolve timestamps.
        </p>
      </div>

      {err && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
          {err}
        </div>
      )}

      {loading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {services.map((service) => {
              const current = cell(service, currentMonth ?? "");
              return (
                <StatCard
                  key={service}
                  label={`${service} — this month`}
                  value={current ? `${(current.uptimePct * 100).toFixed(2)}%` : "—"}
                  tone={
                    !current || current.uptimePct >= 0.999
                      ? "success"
                      : current.uptimePct >= 0.99
                        ? "warning"
                        : "danger"
                  }
                />
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 text-xs uppercase tracking-wide text-zinc-600 dark:text-zinc-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Service</th>
                  {months.map((m) => (
                    <th key={m} className="px-4 py-3 text-right font-medium">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {services.map((service) => (
                  <tr key={service} className="hover:bg-zinc-50/40 dark:hover:bg-zinc-900/40">
                    <td className="px-4 py-3 font-medium text-zinc-800 dark:text-zinc-100">{service}</td>
                    {months.map((m) => {
                      const c = cell(service, m);
                      return (
                        <td
                          key={m}
                          className={clsx(
                            "px-4 py-3 text-right tabular-nums",
                            c ? pctClass(c.uptimePct) : "text-zinc-600"
                          )}
                        >
                          {c ? `${(c.uptimePct * 100).toFixed(2)}%` : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
