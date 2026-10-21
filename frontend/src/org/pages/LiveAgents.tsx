import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { ArrowRight, Search, Smartphone } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { mergeEvents, useLiveStream } from "@/org/lib/live";
import { encodeUserKey } from "@/org/lib/journey";
import { LiveDot } from "@/org/components/LiveOverview";
import { LiveEventDrawer, kindVisual, statusHint } from "@/org/components/LiveEventDrawer";
import { Badge, EmptyState, PageHeader, Panel } from "@/org/components/ui";
import {
  agentLabel,
  agoShort,
  describeLive,
  fmtClock,
  isFailure,
  type AgentPresence,
  type LiveEvent,
} from "@/org/lib/productOps";

const ONLINE_MS = 5 * 60_000;

/** Fold stream events into agent presence, mirroring the server's model. */
function applyToAgents(agents: Map<string, AgentPresence>, batch: LiveEvent[]): Map<string, AgentPresence> {
  const next = new Map(agents);
  for (const e of [...batch].sort((a, b) => a.at.localeCompare(b.at))) {
    const t = Date.parse(e.at);
    const prev = next.get(e.userKey);
    const failed = isFailure(e) ? 1 : 0;
    const action = e.kind === "api" ? `${e.method} ${e.path} → ${e.status || "network"}` : describeLive(e);
    next.set(e.userKey, {
      userKey: e.userKey,
      email: prev?.email ?? e.email,
      userId: prev?.userId ?? e.userId,
      sessionId: e.sessionId,
      firstAt: prev ? Math.min(prev.firstAt, t) : t,
      lastAt: prev ? Math.max(prev.lastAt, t) : t,
      lastScreen: e.kind !== "api" && e.screen ? e.screen : (prev?.lastScreen ?? null),
      lastAction: !prev || t >= prev.lastAt ? action : prev.lastAction,
      events: (prev?.events ?? 0) + 1,
      apiCalls: (prev?.apiCalls ?? 0) + (e.kind === "api" ? 1 : 0),
      errors: (prev?.errors ?? 0) + failed,
      platform: e.platform ?? prev?.platform ?? null,
      appVersion: e.appVersion ?? prev?.appVersion ?? null,
      online: true,
    });
  }
  return next;
}

export function LiveAgentsPage() {
  const { orgId, projectId } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "traffic" ? "traffic" : "agents";
  const selected = params.get("agent");
  const service = params.get("service") ?? "";
  const [agents, setAgents] = useState<Map<string, AgentPresence>>(new Map());
  const [feed, setFeed] = useState<LiveEvent[]>([]);
  const [agentEvents, setAgentEvents] = useState<LiveEvent[]>([]);
  const [olderDone, setOlderDone] = useState(false);
  const [search, setSearch] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, setNow] = useState(Date.now());
  const base = `/console/projects/${projectId}/live`;

  const setParam = useCallback(
    (k: string, v: string | null) => {
      const next = new URLSearchParams(params);
      if (v) next.set(k, v);
      else next.delete(k);
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  useEffect(() => {
    apiFetch<AgentPresence[]>(`${base}/agents`)
      .then((list) => setAgents(new Map(list.map((a) => [a.userKey, a]))))
      .catch(() => undefined);
  }, [base]);

  useEffect(() => {
    const q = new URLSearchParams({ limit: "150" });
    if (service) q.set("service", service);
    apiFetch<LiveEvent[]>(`${base}/events?${q}`).then(setFeed).catch(() => undefined);
  }, [base, service]);

  useEffect(() => {
    setAgentEvents([]);
    setOlderDone(false);
    if (!selected) return;
    apiFetch<LiveEvent[]>(`${base}/events?user=${encodeURIComponent(selected)}&limit=150`)
      .then(setAgentEvents)
      .catch(() => undefined);
  }, [base, selected]);

  // Re-render "x seconds ago" labels and online state.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(t);
  }, []);

  const status = useLiveStream(projectId, {}, {
    onEvents: (batch) => {
      setAgents((cur) => applyToAgents(cur, batch));
      setFeed((cur) => mergeEvents(cur, service ? batch.filter((e) => e.service === service) : batch, 300));
      if (selected) {
        const mine = batch.filter((e) => e.userKey === selected);
        if (mine.length) setAgentEvents((cur) => mergeEvents(cur, mine, 500));
      }
    },
  });

  async function loadOlder() {
    const oldest = agentEvents[agentEvents.length - 1];
    if (!oldest || !selected) return;
    const older = await apiFetch<LiveEvent[]>(`${base}/events?user=${encodeURIComponent(selected)}&before=${encodeURIComponent(oldest.at)}&limit=150`);
    if (older.length === 0) setOlderDone(true);
    setAgentEvents((cur) => mergeEvents(cur, older, 2000));
  }

  const list = useMemo(() => {
    const now = Date.now();
    const q = search.trim().toLowerCase();
    return [...agents.values()]
      .map((a) => ({ ...a, online: now - a.lastAt <= ONLINE_MS }))
      .filter((a) => (!onlineOnly || a.online) && (!q || `${a.email ?? ""} ${a.userId ?? ""} ${a.userKey}`.toLowerCase().includes(q)))
      .sort((a, b) => b.lastAt - a.lastAt);
  }, [agents, search, onlineOnly]);
  const onlineCount = list.filter((a) => a.online).length;
  const agent = selected ? (agents.get(selected) ?? null) : null;

  return (
    <div>
      <PageHeader
        eyebrow="Monitor"
        title="Live"
        description="What agents are doing right now. Pick an agent to follow their journey as it happens, or watch all traffic per service."
        actions={<LiveDot status={status} />}
      />

      <div className="mb-5 flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
        {(["agents", "traffic"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setParam("tab", t === "agents" ? null : t)}
            className={clsx(
              "px-3 py-2 text-sm font-medium",
              tab === t ? "border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400" : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            )}
          >
            {t === "agents" ? `Agents (${onlineCount} online)` : "Traffic"}
          </button>
        ))}
      </div>

      {tab === "agents" ? (
        <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
          <Panel className="flex max-h-[calc(100vh-260px)] flex-col">
            <div className="space-y-2 border-b border-zinc-200 p-3 dark:border-zinc-800">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
                <input className="input pl-8 text-xs" placeholder="Search agent email or id" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" checked={onlineOnly} onChange={(e) => setOnlineOnly(e.target.checked)} /> Online now only
              </label>
            </div>
            <ul className="flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800">
              {list.length === 0 && <li className="p-6 text-center text-xs text-zinc-500">No agents active in the last hour.</li>}
              {list.map((a) => (
                <li key={a.userKey}>
                  <button
                    type="button"
                    onClick={() => setParam("agent", a.userKey)}
                    className={clsx("w-full px-3 py-2.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40", selected === a.userKey && "bg-indigo-50 dark:bg-indigo-500/10")}
                  >
                    <div className="flex items-center gap-2">
                      <span className={clsx("h-2 w-2 shrink-0 rounded-full", a.online ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600")} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{agentLabel(a)}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{agoShort(a.lastAt)}</span>
                    </div>
                    <p className="mt-0.5 truncate pl-4 font-mono text-[11px] text-zinc-500">{a.lastAction}</p>
                    <div className="mt-1 flex gap-1.5 pl-4">
                      {a.lastScreen && <Badge tone="sky">{a.lastScreen}</Badge>}
                      {a.errors > 0 && <Badge tone="red">{a.errors} failed</Badge>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          {!selected ? (
            <Panel>
              <EmptyState title="Select an agent" body="Their screens, taps and API calls will stream here as they happen." />
            </Panel>
          ) : (
            <AgentTimeline
              orgId={orgId!}
              projectId={projectId!}
              userKey={selected}
              agent={agent}
              events={agentEvents}
              olderDone={olderDone}
              onOlder={() => void loadOlder()}
              onOpen={setOpenId}
            />
          )}
        </div>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
            <select className="input w-auto py-1.5 text-xs" value={service} onChange={(e) => setParam("service", e.target.value || null)} aria-label="Service">
              <option value="">All services + journey</option>
              {["MVEND", "KORALINK", "DDIN", "INTEGRA", "RESOLVEIT"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <label className="flex items-center gap-1.5 text-xs text-zinc-500">
              <input type="checkbox" checked={failuresOnly} onChange={(e) => setFailuresOnly(e.target.checked)} /> Failures only
            </label>
            <span className="ml-auto text-xs text-zinc-400">{feed.length} recent events</span>
          </div>
          <EventRows events={feed.filter((e) => !failuresOnly || isFailure(e))} onOpen={setOpenId} showAgent onAgent={(k) => setParams(new URLSearchParams({ agent: k }), { replace: true })} />
        </Panel>
      )}

      {openId && <LiveEventDrawer orgId={orgId!} projectId={projectId!} eventId={openId} onClose={() => setOpenId(null)} onSelect={setOpenId} />}
    </div>
  );
}

function AgentTimeline({
  orgId,
  projectId,
  userKey,
  agent,
  events,
  olderDone,
  onOlder,
  onOpen,
}: {
  orgId: string;
  projectId: string;
  userKey: string;
  agent: AgentPresence | null;
  events: LiveEvent[];
  olderDone: boolean;
  onOlder: () => void;
  onOpen: (id: string) => void;
}) {
  const online = agent ? Date.now() - agent.lastAt <= ONLINE_MS : false;
  const latestSession = events[0]?.sessionId;
  // Live journey: the current session's screens in order, repeats collapsed.
  const journey = useMemo(() => {
    const screens: { screen: string; at: string }[] = [];
    for (const e of [...events].reverse()) {
      if (e.sessionId !== latestSession || (e.kind !== "navigation" && e.kind !== "screen_view") || !e.screen) continue;
      if (screens[screens.length - 1]?.screen !== e.screen) screens.push({ screen: e.screen, at: e.at });
    }
    return screens.slice(-14);
  }, [events, latestSession]);
  const failures = events.filter(isFailure).length;
  const label = agent ? agentLabel(agent) : (events[0] ? agentLabel(events[0]) : userKey);

  return (
    <div className="space-y-4">
      <Panel className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className={clsx("h-2.5 w-2.5 rounded-full", online ? "bg-emerald-500" : "bg-zinc-300")} />
          <p className="text-base font-semibold">{label}</p>
          <Badge tone={online ? "green" : "neutral"}>{online ? "Online" : agent ? `Last seen ${agoShort(agent.lastAt)}` : "Offline"}</Badge>
          {(agent?.platform || agent?.appVersion) && (
            <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
              <Smartphone className="h-3.5 w-3.5" /> {agent?.platform} {agent?.appVersion ? `v${agent.appVersion}` : ""}
            </span>
          )}
          <Link className="ml-auto text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400" to={`/orgs/${orgId}/projects/${projectId}/users/${encodeUserKey(agent?.userId ?? null, agent?.email ?? userKey)}`}>
            Full history →
          </Link>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
          <span>
            <b className="tabular-nums text-zinc-800 dark:text-zinc-200">{events.length}</b> events loaded
          </span>
          <span>
            <b className={clsx("tabular-nums", failures ? "text-red-600" : "text-zinc-800 dark:text-zinc-200")}>{failures}</b> failed calls
          </span>
          {latestSession && <span className="font-mono">session {latestSession.slice(0, 18)}</span>}
        </div>
        {journey.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Live journey</span>
            {journey.map((s, i) => (
              <span key={`${s.screen}-${i}`} className="flex items-center gap-1">
                {i > 0 && <ArrowRight className="h-3 w-3 text-zinc-300" />}
                <span
                  title={fmtClock(s.at)}
                  className={clsx(
                    "rounded-md px-1.5 py-0.5 font-mono text-[11px]",
                    i === journey.length - 1 ? "bg-sky-100 font-semibold text-sky-800 ring-1 ring-sky-300 dark:bg-sky-500/20 dark:text-sky-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  )}
                >
                  {s.screen}
                </span>
              </span>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <div className="border-b border-zinc-200 px-4 py-2.5 text-sm font-medium dark:border-zinc-800">Activity (newest first)</div>
        {events.length === 0 ? (
          <p className="p-8 text-center text-sm text-zinc-500">No recent events for this agent.</p>
        ) : (
          <>
            <EventRows events={events} onOpen={onOpen} timeline />
            {!olderDone && (
              <div className="border-t border-zinc-100 p-3 text-center dark:border-zinc-800">
                <button type="button" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400" onClick={onOlder}>
                  Load older events
                </button>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}

function EventRows({
  events,
  onOpen,
  timeline,
  showAgent,
  onAgent,
}: {
  events: LiveEvent[];
  onOpen: (id: string) => void;
  timeline?: boolean;
  showAgent?: boolean;
  onAgent?: (userKey: string) => void;
}) {
  let lastSession: string | null = null;
  return (
    <ol className={clsx("max-h-[calc(100vh-380px)] overflow-y-auto text-xs", timeline && "relative")}>
      {events.map((e) => {
        const v = kindVisual(e.kind);
        const failed = isFailure(e);
        const newSession = timeline && lastSession !== null && e.sessionId !== lastSession;
        lastSession = e.sessionId;
        return (
          <li key={e.id} className="animate-[fadeIn_0.4s_ease-out]">
            {newSession && <p className="bg-zinc-50 px-4 py-1 text-[10px] uppercase tracking-widest text-zinc-400 dark:bg-zinc-800/40">earlier session</p>}
            <div className={clsx("flex items-center gap-3 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800", failed && "bg-red-50/60 dark:bg-red-500/5")}>
              <span className="w-16 shrink-0 tabular-nums text-zinc-400">{fmtClock(e.at)}</span>
              <span className={clsx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800", failed && "bg-red-100 dark:bg-red-500/20")}>
                <v.icon className={clsx("h-3.5 w-3.5", failed ? "text-red-600" : v.tone)} />
              </span>
              <span className="w-16 shrink-0 text-[11px] text-zinc-400">{v.label}</span>
              {showAgent && (
                <button type="button" onClick={() => onAgent?.(e.userKey)} className="w-40 shrink-0 truncate text-left text-indigo-600 hover:underline dark:text-indigo-400">
                  {agentLabel(e)}
                </button>
              )}
              <button type="button" onClick={() => onOpen(e.id)} className="min-w-0 flex-1 text-left">
                <span className="block truncate font-mono text-zinc-800 hover:text-indigo-600 dark:text-zinc-200">{describeLive(e)}</span>
                {failed && statusHint(e.status) && <span className="block truncate text-[11px] text-red-600">{statusHint(e.status)}</span>}
                {!failed && e.kind === "api" && e.screen && <span className="block truncate text-[11px] text-zinc-400">on {e.screen}</span>}
              </button>
              {e.kind === "api" && (
                <>
                  <span className={clsx("w-12 shrink-0 text-right tabular-nums", failed ? "font-semibold text-red-600" : "text-emerald-600")}>{e.status || "net"}</span>
                  <span className="hidden w-16 shrink-0 text-right tabular-nums text-zinc-400 sm:inline">{e.latencyMs ?? "—"} ms</span>
                </>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
