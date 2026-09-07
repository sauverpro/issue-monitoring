import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import type { FunnelStep, SessionAction } from "@/org/types";
import {
  encodeUserKey,
  formatClockHm,
  formatDuration,
  localISODate,
} from "@/org/lib/journey";
import { ApiDetailDrawer } from "@/org/components/ApiDetailDrawer";
import { JourneyFunnelViz } from "@/org/components/JourneyFunnelViz";
import { JourneyTimeline } from "@/org/components/JourneyTimeline";
import { PageHeader, StatCard } from "@/org/components/ui";

type Detail = {
  sessionId: string;
  user: { id?: string | null; email: string | null; role: string | null; accountType: string | null };
  summary: {
    totalActions: number;
    successfulActions: number;
    failedActions: number;
    apiCalls: number;
    errorRate: number;
    startedAt: string | null;
    endedAt: string | null;
  };
  actions: SessionAction[];
  startedAt?: string | null;
  endedAt?: string | null;
};

export function SessionDetailPage() {
  const { orgId, projectId, sessionId } = useParams();
  const [data, setData] = useState<Detail | null>(null);
  const [funnel, setFunnel] = useState<FunnelStep[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SessionAction | null>(null);

  useEffect(() => {
    if (!projectId || !sessionId) return;
    apiFetch<Detail>(`/console/projects/${projectId}/sessions/${encodeURIComponent(sessionId)}`)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [projectId, sessionId]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<{ steps: FunnelStep[] }>(`/console/projects/${projectId}/reports/funnels?days=30`)
      .then((f) => setFunnel(f.steps))
      .catch(() => undefined);
  }, [projectId]);

  const chronological = useMemo(
    () =>
      data
        ? [...data.actions].sort((a, b) => {
            if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
            return a.actionIndex - b.actionIndex;
          })
        : [],
    [data]
  );

  if (error) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;

  const started = data.startedAt ?? data.summary.startedAt;
  const ended = data.endedAt ?? data.summary.endedAt;
  const durationMs =
    started && ended ? new Date(ended).getTime() - new Date(started).getTime() : 0;
  const userKey = encodeUserKey(data.user.id, data.user.email);
  const title = data.user.email ?? data.user.id ?? data.sessionId.slice(0, 18);
  const date = started ? localISODate(new Date(started)) : localISODate();
  const back = userKey
    ? `/orgs/${orgId}/projects/${projectId}/users/${userKey}?date=${date}&session=${encodeURIComponent(data.sessionId)}`
    : `/orgs/${orgId}/projects/${projectId}/sessions`;

  return (
    <div>
      <Link to={back} className="mb-3 inline-block text-sm text-indigo-600 dark:text-indigo-400">
        ← {userKey ? "User journey" : "Sessions"}
      </Link>
      <PageHeader
        eyebrow="Session"
        title={title}
        description={
          started
            ? `${formatClockHm(started)} · ID ${data.sessionId.slice(0, 18)}…`
            : `ID ${data.sessionId}`
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Started" value={started ? new Date(started).toLocaleString() : "—"} />
        <StatCard label="Duration" value={formatDuration(durationMs)} />
        <StatCard label="Actions" value={data.summary.totalActions} />
        <StatCard
          label="API calls"
          value={data.summary.apiCalls}
          hint={`${data.summary.failedActions} errors`}
        />
      </div>

      {funnel.length > 0 && (
        <div className="mb-8">
          <JourneyFunnelViz steps={funnel.slice(0, 5)} />
        </div>
      )}

      <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900/60">
        <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
          Session timeline
        </h3>
        <JourneyTimeline actions={chronological} onSelect={setSelected} />
      </div>

      {selected && <ApiDetailDrawer action={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
