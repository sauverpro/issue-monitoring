import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCircle2, Siren } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { orgRoleFor, roleAtLeast, useAuth } from "@/org/lib/auth";
import { encodeUserKey } from "@/org/lib/journey";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { Badge, EmptyState, Modal, PageHeader, Panel, StatCard } from "@/org/components/ui";
import {
  fmtMinutes,
  fmtPct,
  rateTone,
  severityTone,
  type IncidentDetail,
  type IncidentReport,
} from "@/org/lib/productOps";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const PAGE = 25;

const STATUS_TONE = { open: "red", investigating: "amber", resolved: "green" } as const;

export function IncidentsPage() {
  const { orgId, projectId } = useParams();
  const { auth } = useAuth();
  const role = orgRoleFor(auth, orgId);
  const { range } = useRange();
  const [data, setData] = useState<IncidentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [service, setService] = useState("");
  const [severity, setSeverity] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const base = `/console/projects/${projectId}`;

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<IncidentReport>(`${base}/incidents?${range.query}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incidents");
    }
  }, [base, range.query]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () =>
      (data?.incidents ?? []).filter((i) => (!service || i.service === service) && (!severity || i.severity === severity)),
    [data, service, severity]
  );

  useEffect(() => setVisible(PAGE), [service, severity, range.query]);

  if (error && !data) return <p className="text-red-600">{error}</p>;
  if (!data) return <p className="text-zinc-500">Loading…</p>;
  const s = data.summary;

  return (
    <div>
      <PageHeader
        eyebrow="Application"
        title="Incidents"
        description="Outages and degradations on the services this app depends on: when they were raised, how long they lasted, who they hit and how they were resolved."
        actions={<TimeRangePicker />}
      />

      {s.openNow > 0 && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
          <Siren className="h-4 w-4 shrink-0" />
          {s.openNow} incident{s.openNow === 1 ? " is" : "s are"} open right now.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Incidents" value={s.total.toLocaleString()} hint={Object.entries(s.bySeverity).sort().map(([k, v]) => `${k} ${v}`).join(" · ") || range.label} />
        <StatCard label="Median time to resolve" value={fmtMinutes(s.medianResolutionMinutes)} hint={`90% within ${fmtMinutes(s.p90ResolutionMinutes)}`} />
        <StatCard label="Mean time to resolve" value={fmtMinutes(s.meanResolutionMinutes)} hint={`Longest ${fmtMinutes(s.longestMinutes)}`} />
        <StatCard label="Agents affected" value={s.usersAffected.toLocaleString()} hint="Hit a failed call during an incident" />
        <StatCard
          label="Resolved by"
          value={s.autoResolvedShare == null ? "—" : `${fmtPct(s.autoResolvedShare, 0)} auto`}
          hint={`${s.manuallyResolved} by an operator`}
        />
      </div>

      <Panel className="mb-6">
        <div className="border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">Service reliability · {range.label}</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="table-head">
              <tr>
                <th className="px-5 py-2">Service</th>
                <th className="px-3 py-2 text-right">Incidents</th>
                <th className="px-3 py-2 text-right">Downtime</th>
                <th className="px-3 py-2 text-right">Availability</th>
                <th className="px-3 py-2 text-right">Median fix</th>
                <th className="px-5 py-2 text-right">Alerts at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {data.byService.map((r) => (
                <tr key={r.service} className="cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40" onClick={() => setService(service === r.service ? "" : r.service)}>
                  <td className="px-5 py-2.5">
                    <span className="font-medium">{r.label}</span>
                    {r.payment && (
                      <span className="ml-2">
                        <Badge tone="indigo">Payments</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.incidents}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMinutes(r.downtimeMinutes)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Badge tone={rateTone(r.availability, 0.995, 0.97)}>{fmtPct(r.availability, 2)}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtMinutes(r.medianResolutionMinutes)}</td>
                  <td className="px-5 py-2.5 text-right text-xs text-zinc-500">{+r.thresholdPct.toFixed(1)}% errors</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <p className="text-sm font-medium">Incident log</p>
          <span className="text-xs text-zinc-400">
            {rows.length.toLocaleString()} shown{data.incidents.length < s.total ? ` (latest ${data.incidents.length} of ${s.total})` : ""}
          </span>
          <div className="ml-auto flex gap-2">
            <select className="input w-auto py-1.5 text-xs" value={service} onChange={(e) => setService(e.target.value)} aria-label="Service">
              <option value="">All services</option>
              {data.services.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <select className="input w-auto py-1.5 text-xs" value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
              <option value="">All severities</option>
              {["P1", "P2", "P3", "P4"].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No incidents" body="Nothing was raised for these filters in the selected period." />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.slice(0, visible).map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setOpenId(i.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 md:flex-row md:items-center md:gap-4">
                  <div className="flex shrink-0 items-center gap-1.5 md:w-44">
                    <Badge tone={severityTone(i.severity)}>{i.severity}</Badge>
                    <Badge tone={STATUS_TONE[i.status as keyof typeof STATUS_TONE] ?? "neutral"}>{i.status}</Badge>
                    <span className="text-xs font-medium text-zinc-500">{i.service}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-900 dark:text-zinc-100">{i.title}</p>
                    <p className="truncate text-xs text-zinc-500">
                      {i.status === "resolved"
                        ? i.autoResolved && i.notes === 0
                          ? "Recovered automatically"
                          : i.resolution ?? "Resolved"
                        : "Ongoing"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-4 text-xs tabular-nums text-zinc-500">
                    <span>{fmtDateTime(i.openedAt)}</span>
                    <span className="w-16 text-right">{fmtMinutes(i.durationMinutes)}</span>
                    <span className="w-20 text-right">{i.usersAffected} agent{i.usersAffected === 1 ? "" : "s"}</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows.length > visible && (
          <div className="border-t border-zinc-100 px-4 py-3 text-center dark:border-zinc-800">
            <button type="button" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onClick={() => setVisible((v) => v + PAGE * 2)}>
              Show more ({(rows.length - visible).toLocaleString()} remaining)
            </button>
          </div>
        )}
      </Panel>

      {openId && (
        <IncidentModal
          base={base}
          incidentId={openId}
          userBase={`/orgs/${orgId}/projects/${projectId}/users`}
          canNote={roleAtLeast(role, "member")}
          canResolve={roleAtLeast(role, "admin")}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function IncidentModal({
  base,
  incidentId,
  userBase,
  canNote,
  canResolve,
  onClose,
  onChanged,
}: {
  base: string;
  incidentId: string;
  userBase: string;
  canNote: boolean;
  canResolve: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [d, setD] = useState<IncidentDetail | null>(null);
  const [note, setNote] = useState("");
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setD(await apiFetch<IncidentDetail>(`${base}/incidents/${incidentId}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load incident");
    }
  }, [base, incidentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setBusy(true);
    try {
      await apiFetch(`${base}/incidents/${incidentId}/notes`, { method: "POST", json: { body: note } });
      setNote("");
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add note");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: "investigating" | "resolved") {
    setBusy(true);
    try {
      await apiFetch(`${base}/incidents/${incidentId}`, {
        method: "PATCH",
        json: { status, ...(status === "resolved" && resolution.trim() ? { resolution: resolution.trim() } : {}) },
      });
      await Promise.all([load(), onChanged()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={d ? `${d.service} · ${d.severity}` : "Incident"} onClose={onClose} wide>
      {!d ? (
        <p className="text-sm text-zinc-500">{error ?? "Loading…"}</p>
      ) : (
        <div className="space-y-5 text-sm">
          <div>
            <p className="font-medium text-zinc-900 dark:text-zinc-100">{d.title}</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <Meta label="Opened" value={fmtDateTime(d.openedAt)} />
              <Meta label={d.resolvedAt ? "Resolved" : "Status"} value={d.resolvedAt ? fmtDateTime(d.resolvedAt) : d.status} />
              <Meta label="Duration" value={fmtMinutes(d.durationMinutes)} />
              <Meta label="Error rate at trigger" value={fmtPct(d.triggerErrorRate)} />
            </div>
            {d.resolutionReason && <p className="mt-2 text-xs text-zinc-500">{d.resolutionReason}</p>}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Failing calls</p>
              {d.failingEndpoints.length === 0 ? (
                <p className="text-xs text-zinc-500">No failed calls recorded during the incident window.</p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {d.failingEndpoints.map((e) => (
                    <li key={`${e.method} ${e.path}`} className="flex justify-between gap-2">
                      <span className="truncate font-mono">
                        {e.method} {e.path}
                      </span>
                      <span className="shrink-0 tabular-nums text-zinc-500">
                        {e.failures}× {e.lastStatus ? `· ${e.lastStatus}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Agents affected ({d.affectedUsers.length})</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
                {d.affectedUsers.map((u) => (
                  <li key={u.userKey} className="flex justify-between gap-2">
                    <Link className="truncate text-indigo-600 hover:underline dark:text-indigo-400" to={`${userBase}/${encodeUserKey(u.userKey, u.email)}`}>
                      {u.email ?? u.userKey}
                    </Link>
                    <span className="tabular-nums text-zinc-500">{u.failures} failed</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Notes</p>
            {d.notesList.length === 0 ? (
              <p className="text-xs text-zinc-500">No notes yet. Record what was found and how it was fixed — it appears in the quarterly report.</p>
            ) : (
              <ol className="space-y-2">
                {d.notesList.map((n) => (
                  <li key={n.id} className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/60">
                    <p className="whitespace-pre-wrap">{n.body}</p>
                    <p className="mt-1 text-[11px] text-zinc-400">
                      {n.author ?? "—"} · {fmtDateTime(n.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {canNote && (
              <form onSubmit={addNote} className="mt-3 flex gap-2">
                <input className="input" value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} placeholder="Add a note: cause, action taken, follow-up…" />
                <button className="btn-secondary" disabled={busy || !note.trim()}>
                  Add
                </button>
              </form>
            )}
          </div>

          {canResolve && d.status !== "resolved" && (
            <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {d.status === "open" && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void setStatus("investigating")}>
                  Mark investigating
                </button>
              )}
              <input className="input min-w-[200px] flex-1" value={resolution} maxLength={500} onChange={(e) => setResolution(e.target.value)} placeholder="How was it resolved? (optional)" />
              <button type="button" className="btn-primary" disabled={busy} onClick={() => void setStatus("resolved")}>
                <CheckCircle2 className="mr-1.5 h-4 w-4" /> Resolve
              </button>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-zinc-400">{label}</p>
      <p className="text-zinc-800 dark:text-zinc-200">{value}</p>
    </div>
  );
}
