import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { ArrowLeft, UserRound } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import {
  classifyKind,
  dayBounds,
  eventDomId,
  formatClockHm,
  formatDayHeading,
  formatDuration,
  localISODate,
  relativeTime,
} from "@/org/lib/journey";
import type { FunnelStep, JourneyDay, JourneyUser, SessionAction } from "@/org/types";
import { ActivityHeatmap } from "@/org/components/ActivityHeatmap";
import { ApiDetailDrawer } from "@/org/components/ApiDetailDrawer";
import { JourneyTimeline } from "@/org/components/JourneyTimeline";
import { JourneyFunnelViz } from "@/org/components/JourneyFunnelViz";
import { EmptyState, Panel, StatCard } from "@/org/components/ui";

type TimelinePayload = {
  actions: SessionAction[];
};

type SessionRow = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  actions: number;
  errors: number;
};

type DaysPayload = {
  days: JourneyDay[];
  sessions: SessionRow[];
};

export function UserJourneyPage() {
  const { orgId, projectId, userKey } = useParams();
  const [params, setParams] = useSearchParams();
  const [profile, setProfile] = useState<JourneyUser | null>(null);
  const [selectedDay, setSelectedDay] = useState(params.get("date") || localISODate());
  const [month, setMonth] = useState(() => {
    const d = params.get("date") || localISODate();
    const p = new Date(`${d}T12:00:00`);
    return new Date(p.getFullYear(), p.getMonth(), 1);
  });
  const [dayData, setDayData] = useState<DaysPayload | null>(null);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [selected, setSelected] = useState<SessionAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const selectedSessionId = params.get("session");
  const range = useMemo(() => dayBounds(selectedDay), [selectedDay]);

  const daySessions = useMemo(() => {
    return (dayData?.sessions ?? [])
      .filter((s) => localISODate(new Date(s.startedAt)) === selectedDay)
      .slice()
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  }, [dayData, selectedDay]);

  const activeSession = daySessions.find((s) => s.sessionId === selectedSessionId) ?? null;

  const monthRange = useMemo(() => {
    const y = month.getFullYear();
    const m = month.getMonth();
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0, 23, 59, 59, 999);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [month]);

  useEffect(() => {
    if (!projectId || !userKey) return;
    apiFetch<JourneyUser>(`/console/projects/${projectId}/users/${userKey}`)
      .then((p) => {
        setProfile(p);
        if (!params.get("date")) {
          setSelectedDay(localISODate(new Date(p.lastActive)));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, userKey]);

  useEffect(() => {
    if (!projectId || !userKey) return;
    const q = new URLSearchParams({ from: monthRange.from, to: monthRange.to });
    apiFetch<DaysPayload>(`/console/projects/${projectId}/users/${userKey}/days?${q}`)
      .then(setDayData)
      .catch(() => undefined);
  }, [projectId, userKey, monthRange.from, monthRange.to]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<{ steps: FunnelStep[] }>(`/console/projects/${projectId}/reports/funnels?days=30`)
      .then((f) => setFunnel(f.steps))
      .catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    if (dayData == null) return;
    const sessions = (dayData.sessions ?? [])
      .filter((s) => localISODate(new Date(s.startedAt)) === selectedDay)
      .slice()
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const current = params.get("session");
    if (current && sessions.some((s) => s.sessionId === current)) return;
    const withErr = sessions.find((s) => s.errors > 0);
    const pick = withErr ?? sessions[0];
    const next = new URLSearchParams();
    next.set("date", selectedDay);
    if (pick) next.set("session", pick.sessionId);
    setParams(next, { replace: true });
  }, [selectedDay, dayData]);

  useEffect(() => {
    if (!projectId || !userKey || !selectedSessionId) {
      setTimeline(null);
      return;
    }
    const q = new URLSearchParams({ from: range.from, to: range.to, sessionId: selectedSessionId });
    apiFetch<TimelinePayload>(`/console/projects/${projectId}/users/${userKey}/timeline?${q}`)
      .then((data) => {
        setTimeline(data);
        const fail = data.actions.find((a) => {
          const k = classifyKind(a);
          return k === "api_failure" || k === "error" || a.status === "failure";
        });
        if (fail) {
          requestAnimationFrame(() => {
            document.getElementById(eventDomId(fail.id))?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          });
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, userKey, selectedSessionId, range.from, range.to]);

  function pickDay(date: string) {
    setSelectedDay(date);
    const d = new Date(`${date}T12:00:00`);
    setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
    const next = new URLSearchParams();
    next.set("date", date);
    setParams(next, { replace: true });
  }

  function pickSession(id: string) {
    const next = new URLSearchParams();
    next.set("date", selectedDay);
    next.set("session", id);
    setParams(next, { replace: true });
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (!profile) return <p className="text-zinc-500">Loading…</p>;

  const name = profile.email || `User ${profile.userId ?? profile.userKey}`;
  const isActive = Date.now() - new Date(profile.lastActive).getTime() < 7 * 86400000;
  const chronological = timeline
    ? [...timeline.actions].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
        return a.actionIndex - b.actionIndex;
      })
    : [];

  return (
    <div>
      <Link
        to={`/orgs/${orgId}/projects/${projectId}/users`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400"
      >
        <ArrowLeft className="h-4 w-4" />
        Users
      </Link>

      <div className="mb-6 flex flex-wrap items-start gap-4">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
          <UserRound className="h-7 w-7" />
        </span>
        <div className="min-w-0 flex-1">
          {isActive && (
            <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              ● Active
            </span>
          )}
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">{name}</h1>
          {profile.userId && (
            <p className="mt-1 font-mono text-xs text-zinc-500">User ID: {profile.userId}</p>
          )}
          <p className="mt-1 text-sm text-zinc-500">Last active {relativeTime(profile.lastActive)}</p>
        </div>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Sessions" value={profile.sessions} />
        <StatCard label="Actions" value={profile.actions} />
        <StatCard
          label="Errors"
          value={profile.errors}
          hint={profile.errors > 0 ? "🔴" : undefined}
        />
        <StatCard label="Time spent" value={formatDuration(profile.durationMs)} />
      </div>

      <Panel className="mb-8">
        <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
          Activity calendar
        </div>
        <div className="p-5">
          <ActivityHeatmap
            month={month}
            days={dayData?.days ?? []}
            selected={selectedDay}
            onSelect={pickDay}
            onMonthChange={setMonth}
          />
        </div>
      </Panel>

      <h2 className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-200">
        {formatDayHeading(selectedDay)}
      </h2>
      {daySessions.length === 0 ? (
        <Panel className="mb-8">
          <EmptyState title="No sessions this day" body="Pick another day in the calendar." />
        </Panel>
      ) : (
        <ul className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {daySessions.map((s) => {
            const active = s.sessionId === selectedSessionId;
            return (
              <li key={s.sessionId}>
                <button
                  type="button"
                  onClick={() => pickSession(s.sessionId)}
                  className={clsx(
                    "w-full rounded-2xl border px-4 py-4 text-left transition",
                    active
                      ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-500/15"
                      : s.errors > 0
                        ? "border-red-200 bg-white hover:border-red-300 dark:border-red-500/30 dark:bg-zinc-900/60"
                        : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60"
                  )}
                >
                  <p className="text-base font-semibold tabular-nums">
                    {formatClockHm(s.startedAt)} session
                  </p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {formatDuration(s.durationMs)} · {s.actions} actions
                  </p>
                  {s.errors > 0 ? (
                    <p className="mt-2 text-sm font-medium text-red-600">🔴 {s.errors} errors</p>
                  ) : (
                    <p className="mt-2 text-sm text-zinc-400">No API errors</p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {activeSession && (
        <div ref={timelineRef} className="scroll-mt-20 space-y-6">
          {funnel.length > 0 && <JourneyFunnelViz steps={funnel.slice(0, 5)} />}
          <Panel>
            <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <p className="text-sm font-medium">
                {formatClockHm(activeSession.startedAt)} session timeline
              </p>
              <p className="text-xs text-zinc-500">
                Watch what happened — screens, clicks, and API calls in order.
              </p>
            </div>
            <div className="p-5">
              <JourneyTimeline actions={chronological} onSelect={setSelected} />
            </div>
          </Panel>
        </div>
      )}
      {selected && <ApiDetailDrawer action={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}