import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { StatusBadge, type ServiceStatus } from "@/components/StatusBadge";
import { ThemeToggle } from "@/components/ThemeToggle";

type StatusPayload = {
  overall: ServiceStatus;
  services: { service: string; status: ServiceStatus; last_seen: string | null }[];
  tracked_apis: { id: string; label: string; status: ServiceStatus; last_seen: string | null }[];
  incidents: {
    id: string;
    service: string;
    severity: string;
    status: string;
    title: string;
    opened_at: string;
    resolved_at: string | null;
  }[];
  uptime_this_month: { service: string; uptimePct: number }[];
  generated_at: string;
};

const OVERALL_COPY: Record<ServiceStatus, string> = {
  operational: "All systems operational",
  degraded: "Some systems degraded",
  down: "Service outage in progress",
};

export function Status() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch<StatusPayload>("/status");
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load status");
      }
    }
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 px-4 py-10">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <Activity className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            </span>
            <div>
              <h1 className="text-xl font-semibold text-zinc-900 dark:text-white">Koralink Status</h1>
              <p className="text-sm text-zinc-600 dark:text-zinc-500">Live health of MVEND, Koralink, DDIN, Integra, and ResolveIt</p>
            </div>
          </div>
          <ThemeToggle className="rounded-md p-2 text-zinc-600 dark:text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900" />
        </div>

        {err && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-200">
            {err}
          </div>
        )}

        {!data ? (
          <p className="text-zinc-600 dark:text-zinc-500">Loading…</p>
        ) : (
          <>
            <section
              className={
                "rounded-xl border p-5 " +
                (data.overall === "operational"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : data.overall === "degraded"
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-red-500/30 bg-red-500/5")
              }
            >
              <p className="text-lg font-semibold text-zinc-900 dark:text-white">{OVERALL_COPY[data.overall]}</p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                Updated {new Date(data.generated_at).toLocaleTimeString()}
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-400">Product lines</h2>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
                {data.services.map((s) => {
                  const uptime = data.uptime_this_month.find((u) => u.service === s.service);
                  return (
                    <div key={s.service} className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="font-medium text-zinc-800 dark:text-zinc-100">{s.service}</p>
                        {uptime && (
                          <p className="text-xs text-zinc-600 dark:text-zinc-500">
                            {(uptime.uptimePct * 100).toFixed(2)}% uptime this month
                          </p>
                        )}
                      </div>
                      <StatusBadge status={s.status} />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-400">External APIs</h2>
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30">
                {data.tracked_apis.map((a) => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-3">
                    <p className="font-medium text-zinc-800 dark:text-zinc-100">{a.label}</p>
                    <StatusBadge status={a.status} />
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-400">Recent incidents</h2>
              {data.incidents.length === 0 ? (
                <p className="text-sm text-zinc-600 dark:text-zinc-500">No incidents recorded.</p>
              ) : (
                <ul className="space-y-2">
                  {data.incidents.map((i) => (
                    <li
                      key={i.id}
                      className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/30 dark:bg-zinc-900/30 px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">{i.title}</p>
                        <span className="shrink-0 rounded-md bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 text-xs text-zinc-600 dark:text-zinc-300">
                          {i.status}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">
                        {i.service} · opened {new Date(i.opened_at).toLocaleString()}
                        {i.resolved_at &&
                          ` · resolved ${new Date(i.resolved_at).toLocaleString()}`}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
