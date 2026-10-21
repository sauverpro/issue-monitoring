import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Pause, Play, Radio, Siren, X } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { mergeEvents, useLiveStream, type LiveIncident, type LiveStatus } from "@/org/lib/live";
import { Sparkline } from "@/org/components/charts";
import { Badge, Panel } from "@/org/components/ui";
import { LiveEventDrawer, kindVisual } from "@/org/components/LiveEventDrawer";
import {
  agentLabel,
  describeLive,
  fmtClock,
  fmtPct,
  isFailure,
  type AgentPresence,
  type LiveEvent,
  type LiveSnapshot,
  type ServiceLive,
} from "@/org/lib/productOps";

const STATUS_STYLE: Record<ServiceLive["status"], { label: string; tone: "green" | "amber" | "red" | "neutral"; ring: string }> = {
  operational: { label: "Operational", tone: "green", ring: "ring-emerald-500/20" },
  degraded: { label: "Degraded", tone: "amber", ring: "ring-amber-500/50" },
  down: { label: "Down", tone: "red", ring: "ring-red-500/60" },
  idle: { label: "Idle", tone: "neutral", ring: "ring-transparent" },
};

export function LiveDot({ status }: { status: LiveStatus }) {
  const live = status === "live";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className="relative flex h-2.5 w-2.5">
        {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
        <span className={clsx("relative inline-flex h-2.5 w-2.5 rounded-full", live ? "bg-emerald-500" : status === "paused" ? "bg-zinc-400" : "bg-amber-500")} />
      </span>
      <span className={live ? "text-emerald-700 dark:text-emerald-300" : "text-zinc-500"}>
        {live ? "Live" : status === "paused" ? "Paused" : status === "reconnecting" ? "Reconnecting…" : "Connecting…"}
      </span>
    </span>
  );
}

type Toast = { key: string; kind: "opened" | "updated" | "resolved"; incident: LiveIncident };

export function LiveOverview({ orgId, projectId }: { orgId: string; projectId: string }) {
  const [snap, setSnap] = useState<LiveSnapshot | null>(null);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [service, setService] = useState("");
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [paused, setPaused] = useState(false);
  const [held, setHeld] = useState<LiveEvent[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flash, setFlash] = useState<Record<string, number>>({});

  useEffect(() => {
    apiFetch<{ snapshot: LiveSnapshot; events: LiveEvent[]; agents: AgentPresence[] }>(`/console/projects/${projectId}/live/snapshot`)
      .then((r) => {
        setSnap(r.snapshot);
        setEvents(r.events);
      })
      .catch(() => undefined);
  }, [projectId]);

  const status = useLiveStream(
    projectId,
    {},
    {
      onEvents: (batch) => {
        if (paused) setHeld((h) => mergeEvents(h, batch, 300));
        else setEvents((cur) => mergeEvents(cur, batch));
      },
      onTick: (s) =>
        setSnap((prev) => {
          // Briefly highlight tiles whose status changed.
          if (prev) {
            const changed: Record<string, number> = {};
            for (const svc of s.services) {
              const before = prev.services.find((p) => p.service === svc.service);
              if (before && before.status !== svc.status) changed[svc.service] = Date.now();
            }
            if (Object.keys(changed).length) setFlash((f) => ({ ...f, ...changed }));
          }
          return s;
        }),
      onIncident: (kind, incident) => {
        if (kind === "updated" && incident.status !== "resolved") return;
        const t: Toast = { key: `${incident.id}-${kind}-${Date.now()}`, kind: kind === "updated" ? "resolved" : kind, incident };
        setToasts((cur) => [t, ...cur].slice(0, 4));
        window.setTimeout(() => setToasts((cur) => cur.filter((x) => x.key !== t.key)), 10_000);
      },
    }
  );

  // Refetch the summary once whenever we come back from a disconnect.
  useEffect(() => {
    if (status !== "live") return;
    apiFetch<{ snapshot: LiveSnapshot; events: LiveEvent[] }>(`/console/projects/${projectId}/live/snapshot`)
      .then((r) => {
        setSnap(r.snapshot);
        setEvents((cur) => mergeEvents(cur, r.events));
      })
      .catch(() => undefined);
  }, [status, projectId]);

  const services = useMemo(() => (snap?.services ?? []).filter((s) => s.service !== "CUSTOM" || s.calls5m > 0), [snap]);
  const feed = useMemo(
    () => events.filter((e) => (!service || e.service === service) && (!failuresOnly || isFailure(e))),
    [events, service, failuresOnly]
  );
  const base = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <section className="mb-8 space-y-4">
      <Panel>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
          <LiveDot status={status} />
          <Metric label="Agents online" value={snap?.agentsOnline} />
          <Metric label="Calls / min" value={snap?.callsPerMin} />
          <Metric label="Errors / min" value={snap?.errorsPerMin} danger={(snap?.errorsPerMin ?? 0) > 0} />
          <span className="text-[11px] text-zinc-400">{snap ? `Updated ${fmtClock(snap.at)}` : ""}</span>
          <Link to={`${base}/live`} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            <Radio className="h-4 w-4" /> Live agents
          </Link>
        </div>
      </Panel>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {services.map((s) => {
          const st = STATUS_STYLE[s.status];
          const flashing = flash[s.service] && Date.now() - flash[s.service]! < 4000;
          return (
            <button
              key={s.service}
              type="button"
              onClick={() => setService(service === s.service ? "" : s.service)}
              className={clsx(
                "rounded-2xl border bg-white p-4 text-left shadow-sm ring-2 transition dark:bg-zinc-900/60",
                st.ring,
                service === s.service ? "border-indigo-400" : "border-zinc-200/80 dark:border-zinc-800",
                flashing && "animate-pulse"
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">{s.service}</p>
                <Badge tone={st.tone}>{st.label}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-zinc-500">
                <span>
                  <span className="block text-base font-semibold tabular-nums text-zinc-900 dark:text-white">{s.calls1m}</span>calls/min
                </span>
                <span>
                  <span className={clsx("block text-base font-semibold tabular-nums", (s.errorRate1m ?? 0) > 0 ? "text-red-600" : "text-zinc-900 dark:text-white")}>
                    {fmtPct(s.errorRate1m, 0)}
                  </span>
                  errors
                </span>
                <span>
                  <span className="block text-base font-semibold tabular-nums text-zinc-900 dark:text-white">{s.p95Ms1m == null ? "—" : `${s.p95Ms1m}`}</span>p95 ms
                </span>
              </div>
              <Sparkline className="mt-2" values={s.series.map((p) => p.calls)} />
              {s.series.some((p) => p.errors > 0) && (
                <Sparkline className="-mt-8 opacity-90" color="rgb(239 68 68)" values={s.series.map((p) => p.errors)} />
              )}
              <p className="mt-1 text-[11px] text-zinc-400">
                {s.agents1m} agent{s.agents1m === 1 ? "" : "s"} · last 15 min
              </p>
            </button>
          );
        })}
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
          <p className="text-sm font-medium">Live activity</p>
          {service && (
            <button type="button" onClick={() => setService("")} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              {service} <X className="h-3 w-3" />
            </button>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-zinc-500">
            <input type="checkbox" checked={failuresOnly} onChange={(e) => setFailuresOnly(e.target.checked)} /> Failures only
          </label>
          <button
            type="button"
            className="btn-secondary px-2 py-1 text-xs"
            onClick={() => {
              if (paused) {
                setEvents((cur) => mergeEvents(cur, held));
                setHeld([]);
              }
              setPaused(!paused);
            }}
          >
            {paused ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
            {paused ? `Resume${held.length ? ` (${held.length} new)` : ""}` : "Pause"}
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {feed.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-zinc-500">Waiting for activity…</p>
          ) : (
            <ul className="divide-y divide-zinc-100 text-xs dark:divide-zinc-800">
              {feed.slice(0, 150).map((e) => {
                const v = kindVisual(e.kind);
                return (
                  <li key={e.id} className="animate-[fadeIn_0.4s_ease-out]">
                    <button type="button" onClick={() => setOpenId(e.id)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      <span className="w-16 shrink-0 tabular-nums text-zinc-400">{fmtClock(e.at)}</span>
                      <v.icon className={clsx("h-3.5 w-3.5 shrink-0", v.tone)} />
                      <span className="w-44 shrink-0 truncate text-zinc-600 dark:text-zinc-300">{agentLabel(e)}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-zinc-800 dark:text-zinc-200">{describeLive(e)}</span>
                      {e.service && <span className="hidden shrink-0 text-zinc-400 sm:inline">{e.service}</span>}
                      {e.kind === "api" && (
                        <span className={clsx("w-14 shrink-0 text-right tabular-nums", isFailure(e) ? "font-semibold text-red-600" : "text-emerald-600")}>
                          {e.status || "net"}
                        </span>
                      )}
                      {e.kind === "api" && <span className="hidden w-16 shrink-0 text-right tabular-nums text-zinc-400 md:inline">{e.latencyMs ?? "—"} ms</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Panel>

      {toasts.length > 0 && (
        <div className="fixed right-4 top-16 z-40 w-80 space-y-2">
          {toasts.map((t) => (
            <div
              key={t.key}
              className={clsx(
                "flex items-start gap-2 rounded-xl border p-3 text-sm shadow-lg",
                t.kind === "resolved"
                  ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-950 dark:text-emerald-100"
                  : "border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-950 dark:text-red-100"
              )}
            >
              <Siren className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {t.incident.service} {t.kind === "resolved" ? "recovered" : `incident ${t.incident.severity ?? ""}`}
                </p>
                {t.incident.title && <p className="truncate text-xs opacity-80">{t.incident.title}</p>}
                <Link to={`${base}/incidents`} className="text-xs font-medium underline">
                  View incidents
                </Link>
              </div>
              <button type="button" onClick={() => setToasts((cur) => cur.filter((x) => x.key !== t.key))} aria-label="Dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {openId && <LiveEventDrawer orgId={orgId} projectId={projectId} eventId={openId} onClose={() => setOpenId(null)} onSelect={setOpenId} />}
    </section>
  );
}

function Metric({ label, value, danger }: { label: string; value: number | undefined; danger?: boolean }) {
  return (
    <span className="text-xs text-zinc-500">
      <span className={clsx("mr-1 text-lg font-semibold tabular-nums", danger ? "text-red-600" : "text-zinc-900 dark:text-white")}>{value ?? "—"}</span>
      {label}
    </span>
  );
}
