import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { CheckCircle2, Info, Radio, Search, ShieldAlert, Wallet, X } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { useCanManage } from "@/org/lib/auth";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { LineChart } from "@/org/components/charts";
import { LiveEventDrawer } from "@/org/components/LiveEventDrawer";
import { Badge, EmptyState, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { agoShort, fmtPct, plural, rateTone, type PaymentsReport } from "@/org/lib/productOps";

type StatusRow = { status: number | null; count: number; agents: number; label: string; hint: string };
type Endpoint = {
  method: string;
  path: string;
  calls: number;
  failures: number;
  agents: number;
  agentsAffected: number;
  topStatus: number | null;
  p95LatencyMs: number | null;
};
type Channel = PaymentsReport["channels"][number] & {
  lastCallAt: string | null;
  granularity: "hour" | "day";
  daily: { date: string; calls: number; failures: number; successRate: number | null }[];
  endpoints: Endpoint[];
  statusBreakdown: StatusRow[];
};
type Report = Omit<PaymentsReport, "channels"> & { channels: Channel[] };

type AffectedAgent = {
  userKey: string;
  email: string | null;
  userId: string | null;
  calls: number;
  failures: number;
  successes: number;
  firstFailureAt: string | null;
  lastFailureAt: string | null;
  lastStatus: number | null;
  lastStatusLabel: string;
  lastError: string | null;
  lastScreen: string | null;
  lastEventId: string | null;
  recoveredAfter: boolean;
  platform: string | null;
  appVersion: string | null;
};
type EndpointDetail = {
  calls: number;
  failures: number;
  successRate: number | null;
  agents: number;
  agentsAffected: number;
  statusBreakdown: StatusRow[];
  granularity: "hour" | "day";
  series: { date: string; calls: number; failures: number }[];
  affected: AffectedAgent[];
};

const statusKey = (s: number | null) => (s == null ? "0" : String(s));
const epKey = (e: { method: string; path: string }) => `${e.method} ${e.path}`;

function bucketLabel(b: string, granularity: "hour" | "day") {
  if (granularity === "hour") return `${b.slice(11, 13)}h`;
  return new Date(`${b}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function statusTone(s: number | null): "red" | "amber" | "neutral" {
  if (s == null || s === 0) return "neutral";
  return s >= 500 || s === 401 ? "red" : "amber";
}

export function PaymentsPage() {
  const { orgId, projectId } = useParams();
  const canManage = useCanManage(orgId);
  const { range } = useRange();
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Report>(`/console/projects/${projectId}/payments?${range.query}`)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load payments"));
  }, [projectId, range.query]);

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const o = data.overall;
  const settings = `/orgs/${orgId}/projects/${projectId}/settings`;
  const primary = data.channels[0];
  const topCause = primary?.statusBreakdown[0];
  const worst = primary?.endpoints.filter((e) => e.failures > 0).sort((a, b) => b.failures - a.failures)[0];

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="Payments"
        description="Can agents move money? Wallet and transfer reliability per payment channel, why calls fail, and exactly which agents were affected."
        actions={<TimeRangePicker />}
      />

      {data.channels.length === 0 ? (
        <Panel>
          <EmptyState
            title="No payment channels tagged"
            body={canManage ? "In Settings, set an upstream's category to Payments (primary or backup) to track it here." : "An admin can tag payment upstreams in Settings."}
          />
        </Panel>
      ) : (
        <>
          <Panel className="mb-6">
            <div className="flex gap-3 p-5">
              <Info className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
              <div className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                <p>
                  <b>{range.label}:</b> {fmtPct(o.successRate)} of {o.calls.toLocaleString()} payment calls succeeded.{" "}
                  {o.failures > 0 ? (
                    <>
                      <b className="text-red-600">{o.failures.toLocaleString()}</b> failed, affecting <b>{plural(o.agentsAffected, "agent")}</b>.
                    </>
                  ) : (
                    "No payment call failed."
                  )}
                </p>
                {topCause && (
                  <p>
                    Main cause: <b>{topCause.label}</b> ({plural(topCause.count, "call")}, {plural(topCause.agents, "agent")}) — {topCause.hint}
                  </p>
                )}
                {worst && (
                  <p>
                    Most failing call: <span className="font-mono">{epKey(worst)}</span> — {worst.failures.toLocaleString()} of {worst.calls.toLocaleString()} failed ({fmtPct(worst.failures / Math.max(1, worst.calls), 0)}).
                  </p>
                )}
              </div>
            </div>
          </Panel>

          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Payment success rate" value={fmtPct(o.successRate)} hint={range.label} />
            <StatCard label="Payment calls" value={o.calls.toLocaleString()} hint={`${o.failures.toLocaleString()} failed`} />
            <StatCard label="Agents affected" value={o.agentsAffected.toLocaleString()} hint="Had at least one failed payment call" />
            <StatCard label="Channels" value={data.channels.length} hint={data.hasBackup ? "Backup configured" : "No backup channel"} />
          </div>

          {!data.hasBackup && (
            <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <b>No backup payment channel.</b> If the primary rail fails, agents cannot transact. Add the mobile-money or second provider's host as an upstream and tag it as a backup payment channel.{" "}
                {canManage && (
                  <Link className="font-medium underline" to={settings}>
                    Open Settings
                  </Link>
                )}
              </p>
            </div>
          )}

          <div className="space-y-8">
            {data.channels.map((c) => (
              <ChannelSection key={c.slug} c={c} orgId={orgId!} projectId={projectId!} query={range.query.toString()} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ChannelSection({ c, orgId, projectId, query }: { c: Channel; orgId: string; projectId: string; query: string }) {
  const [params, setParams] = useSearchParams();
  const method = params.get("method") ?? "";
  const endpoint = params.get("endpoint") ?? "";
  const days = c.daily.filter((d) => d.calls > 0);
  const methods = useMemo(() => [...new Set(c.endpoints.map((e) => e.method).filter(Boolean))].sort(), [c.endpoints]);
  const shown = c.endpoints.filter((e) => !method || e.method === method);
  const selectedEp = c.endpoints.find((e) => epKey(e) === endpoint) ?? null;

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  const now =
    c.statusNow === "no_data"
      ? { label: c.lastCallAt ? `Idle · last call ${agoShort(Date.parse(c.lastCallAt))}` : "Idle · no calls yet", tone: "neutral" as const }
      : c.statusNow === "operational"
        ? { label: "Working now", tone: "green" as const }
        : c.statusNow === "degraded"
          ? { label: "Degraded now", tone: "amber" as const }
          : { label: "Failing now", tone: "red" as const };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet className="h-5 w-5 text-indigo-500" />
        <h2 className="text-lg font-semibold">{c.label}</h2>
        {c.role && <Badge tone={c.role === "primary" ? "indigo" : "sky"}>{c.role === "primary" ? "Primary channel" : "Backup channel"}</Badge>}
        <span className="text-xs text-zinc-400">{c.host}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          <span title="Payment services open an incident when more than this share of calls fails in 5 minutes">Alerts at {+c.thresholdPct.toFixed(1)}% errors</span>
          <Badge tone={now.tone}>{now.label}</Badge>
        </span>
      </div>

      <Panel>
        <div className="grid gap-px bg-zinc-100 dark:bg-zinc-800 sm:grid-cols-3 lg:grid-cols-6">
          {[
            ["Success rate", <Badge key="s" tone={rateTone(c.successRate, 0.98, 0.9)}>{fmtPct(c.successRate)}</Badge>, "Share of calls that worked"],
            ["Calls", c.calls.toLocaleString(), "All payment requests"],
            ["Failed", c.failures.toLocaleString(), "Errors + no response"],
            ["Agents", c.agents.toLocaleString(), "Used this channel"],
            ["Agents affected", c.agentsAffected.toLocaleString(), "Hit at least one failure"],
            ["Incidents", c.incidents.toLocaleString(), "Outage alerts raised"],
          ].map(([label, value, hint]) => (
            <div key={label as string} className="bg-white px-5 py-3 dark:bg-zinc-900/60" title={hint as string}>
              <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
              <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">{c.granularity === "hour" ? "Hourly" : "Daily"} success rate</p>
            {days.length < 2 ? (
              <p className="text-xs text-zinc-500">Not enough traffic in this period to plot a trend.</p>
            ) : (
              <LineChart
                labels={days.map((d) => bucketLabel(d.date, c.granularity))}
                series={[{ name: "Success %", color: "#6366f1", values: days.map((d) => Math.round((d.successRate ?? 0) * 1000) / 10) }]}
                height={170}
              />
            )}
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Why payments fail</p>
            {c.statusBreakdown.length === 0 ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> No failed payment calls.
              </p>
            ) : (
              <ul className="space-y-2">
                {c.statusBreakdown.map((s) => (
                  <li key={statusKey(s.status)} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
                    <div className="flex items-center gap-2 text-sm">
                      <Badge tone={statusTone(s.status)}>{s.status ?? "No response"}</Badge>
                      <span className="font-medium">{s.label}</span>
                      <span className="ml-auto tabular-nums text-xs text-zinc-500">
                        {plural(s.count, "call")} · {plural(s.agents, "agent")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">{s.hint}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="text-sm font-medium">Endpoints</p>
          <div className="flex gap-1">
            {["", ...methods].map((m) => (
              <button
                key={m || "all"}
                type="button"
                onClick={() => set({ method: m || null, endpoint: null })}
                className={clsx(
                  "rounded-md px-2 py-0.5 text-xs font-medium",
                  method === m ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                )}
              >
                {m || "All methods"}
              </button>
            ))}
          </div>
          <select
            className="input ml-auto w-auto max-w-xs py-1.5 font-mono text-xs"
            value={endpoint}
            onChange={(e) => set({ endpoint: e.target.value || null })}
            aria-label="Endpoint"
          >
            <option value="">All endpoints</option>
            {shown.map((e) => (
              <option key={epKey(e)} value={epKey(e)}>
                {epKey(e)} ({e.failures}/{e.calls} failed)
              </option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-2">Call</th>
                <th className="px-3 py-2 text-right">Calls</th>
                <th className="px-3 py-2 text-right">Failed</th>
                <th className="w-40 px-3 py-2">Failure rate</th>
                <th className="px-3 py-2 text-right">Agents affected</th>
                <th className="px-3 py-2">Mostly</th>
                <th className="px-4 py-2 text-right">p95</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {shown.map((e) => {
                const rate = e.failures / Math.max(1, e.calls);
                const active = epKey(e) === endpoint;
                return (
                  <tr
                    key={epKey(e)}
                    onClick={() => set({ endpoint: active ? null : epKey(e) })}
                    className={clsx("cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40", active && "bg-indigo-50 dark:bg-indigo-500/10")}
                  >
                    <td className="max-w-[280px] truncate px-4 py-2 font-mono">{epKey(e)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.calls.toLocaleString()}</td>
                    <td className={clsx("px-3 py-2 text-right tabular-nums", e.failures && "font-semibold text-red-600")}>{e.failures.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                          <div className={clsx("h-full rounded-full", rate > 0.1 ? "bg-red-500" : rate > 0.02 ? "bg-amber-500" : "bg-emerald-500")} style={{ width: `${Math.max(rate * 100, e.failures ? 3 : 0)}%` }} />
                        </div>
                        <span className="w-9 text-right tabular-nums">{fmtPct(rate, 0)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.agentsAffected}</td>
                    <td className="px-3 py-2 text-zinc-500">{e.failures ? (e.topStatus ?? "No response") : "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-500">{e.p95LatencyMs == null ? "—" : `${e.p95LatencyMs.toLocaleString()} ms`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <AffectedAgentsPanel
        orgId={orgId}
        projectId={projectId}
        service={c.slug}
        query={query}
        method={selectedEp?.method ?? method}
        path={selectedEp?.path ?? ""}
        title={selectedEp ? epKey(selectedEp) : method ? `All ${method} calls` : "All payment calls"}
        onClear={selectedEp || method ? () => set({ endpoint: null, method: null }) : undefined}
      />
    </section>
  );
}

function AffectedAgentsPanel({
  orgId,
  projectId,
  service,
  query,
  method,
  path,
  title,
  onClear,
}: {
  orgId: string;
  projectId: string;
  service: string;
  query: string;
  method: string;
  path: string;
  title: string;
  onClear?: () => void;
}) {
  const [d, setD] = useState<EndpointDetail | null>(null);
  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState("");
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => setStatus(""), [method, path]);

  useEffect(() => {
    const q = new URLSearchParams(query);
    q.set("service", service);
    if (method) q.set("method", method);
    if (path) q.set("path", path);
    if (status) q.set("status", status);
    if (search.trim()) q.set("search", search.trim());
    setLoading(true);
    const t = window.setTimeout(() => {
      apiFetch<EndpointDetail>(`/console/projects/${projectId}/payments/endpoint?${q}`)
        .then(setD)
        .catch(() => setD(null))
        .finally(() => setLoading(false));
    }, search ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [projectId, service, query, method, path, status, search]);

  const base = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-sm font-medium">Affected agents</p>
        <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-xs dark:bg-zinc-800">
          {title}
          {onClear && (
            <button type="button" onClick={onClear} aria-label="Clear filter">
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
        {d && (
          <span className="text-xs text-zinc-500">
            {d.failures.toLocaleString()} failed of {plural(d.calls, "call")} · {d.agentsAffected} of {plural(d.agents, "agent")} affected
          </span>
        )}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400" />
          <input className="input w-52 py-1.5 pl-8 text-xs" placeholder="Find agent" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {d && d.statusBreakdown.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setStatus("")}
            className={clsx("rounded-full border px-2.5 py-0.5 text-xs", !status ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300")}
          >
            Any failure
          </button>
          {d.statusBreakdown.map((s) => (
            <button
              key={statusKey(s.status)}
              type="button"
              title={s.hint}
              onClick={() => setStatus(status === statusKey(s.status) ? "" : statusKey(s.status))}
              className={clsx(
                "rounded-full border px-2.5 py-0.5 text-xs",
                status === statusKey(s.status) ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" : "border-zinc-200 text-zinc-600 dark:border-zinc-700 dark:text-zinc-300"
              )}
            >
              {s.status ?? "No response"} · {s.label} <span className="tabular-nums text-zinc-400">({s.agents})</span>
            </button>
          ))}
        </div>
      )}

      {!d ? (
        <p className="p-6 text-sm text-zinc-500">{loading ? "Loading…" : "Could not load affected agents."}</p>
      ) : d.affected.length === 0 ? (
        <EmptyState title="No affected agents" body="Nobody hit a failure on this selection in the period." />
      ) : (
        <div className={clsx("overflow-x-auto", loading && "opacity-60")}>
          <table className="w-full text-xs">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-2">Agent</th>
                <th className="px-3 py-2 text-right">Failed / calls</th>
                <th className="px-3 py-2">What went wrong</th>
                <th className="px-3 py-2">Last failure</th>
                <th className="px-3 py-2">Recovered?</th>
                <th className="px-3 py-2">Device</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {d.affected.map((a) => (
                <tr key={a.userKey} className="align-top">
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-zinc-900 dark:text-zinc-100">{a.email ?? a.userId ?? a.userKey}</p>
                    {a.email && a.userId && a.userId !== a.email && <p className="text-[11px] text-zinc-400">{a.userId}</p>}
                    {a.lastScreen && <p className="text-[11px] text-zinc-400">on {a.lastScreen}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <span className="font-semibold text-red-600">{a.failures}</span>
                    <span className="text-zinc-400"> / {a.calls}</span>
                  </td>
                  <td className="max-w-[280px] px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <Badge tone={statusTone(a.lastStatus)}>{a.lastStatus ?? "—"}</Badge>
                      <span className="font-medium">{a.lastStatusLabel}</span>
                    </div>
                    {a.lastError && <p className="mt-0.5 line-clamp-2 text-[11px] text-zinc-500">“{a.lastError}”</p>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">
                    {a.lastFailureAt ? agoShort(Date.parse(a.lastFailureAt)) : "—"}
                    {a.firstFailureAt && a.lastFailureAt && a.firstFailureAt !== a.lastFailureAt && (
                      <p className="text-[11px] text-zinc-400">since {agoShort(Date.parse(a.firstFailureAt))}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {a.recoveredAfter ? <Badge tone="green">Yes, later succeeded</Badge> : a.successes > 0 ? <Badge tone="amber">Partly</Badge> : <Badge tone="red">No</Badge>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-zinc-500">
                    {a.platform ?? "—"}
                    {a.appVersion ? ` · v${a.appVersion}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {a.lastEventId && (
                      <button type="button" onClick={() => setOpenEvent(a.lastEventId)} className="mr-3 text-indigo-600 hover:underline dark:text-indigo-400">
                        View failure
                      </button>
                    )}
                    <Link to={`${base}/live?agent=${encodeURIComponent(a.userKey)}`} className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400">
                      <Radio className="h-3 w-3" /> Live
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {d.affected.length >= 200 && <p className="px-4 py-2 text-[11px] text-zinc-400">Showing the 200 most affected agents. Search to find others.</p>}
        </div>
      )}
      {openEvent && <LiveEventDrawer orgId={orgId} projectId={projectId} eventId={openEvent} onClose={() => setOpenEvent(null)} onSelect={setOpenEvent} />}
    </Panel>
  );
}
