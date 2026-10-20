import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { CalendarClock, GitCommitHorizontal, Plus, Rocket, Terminal } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useCanManage } from "@/org/lib/auth";
import { Badge, EmptyState, Field, Modal, PageHeader, Panel, StatCard } from "@/org/components/ui";
import { RELEASE_KINDS, fmtDate, releaseKindTone, type ReleaseItem } from "@/org/lib/productOps";

type Draft = {
  id?: string;
  version: string;
  title: string;
  kind: string;
  status: string;
  plannedFor: string;
  notes: string;
};

const EMPTY: Draft = { version: "", title: "", kind: "patch", status: "planned", plannedFor: "", notes: "" };

function daysUntil(date: string): number {
  const target = new Date(`${date}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

function monthKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function ReleasesPage() {
  const { orgId, projectId } = useParams();
  const canManage = useCanManage(orgId);
  const [items, setItems] = useState<ReleaseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [ingestUrl, setIngestUrl] = useState<string | null>(null);
  const base = `/console/projects/${projectId}`;

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch<ReleaseItem[]>(`${base}/releases`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load releases");
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage) return;
    apiFetch<{ ingestUrl: string }>(`${base}/integration`)
      .then((r) => setIngestUrl(r.ingestUrl))
      .catch(() => undefined);
  }, [base, canManage]);

  const upcoming = useMemo(
    () =>
      (items ?? [])
        .filter((r) => r.status === "planned")
        .sort((a, b) => (a.plannedFor ?? "9999").localeCompare(b.plannedFor ?? "9999")),
    [items]
  );
  const shipped = useMemo(() => (items ?? []).filter((r) => r.status === "released" && r.releasedAt), [items]);
  const byMonth = useMemo(() => {
    const groups = new Map<string, ReleaseItem[]>();
    for (const r of shipped) {
      const k = monthKey(r.releasedAt!);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    return [...groups.entries()];
  }, [shipped]);

  const last90 = shipped.filter((r) => Date.now() - new Date(r.releasedAt!).getTime() < 90 * 86400000);
  const overdue = upcoming.filter((r) => r.plannedFor && daysUntil(r.plannedFor) < 0).length;

  async function setStatus(r: ReleaseItem, status: string) {
    try {
      await apiFetch(`${base}/releases/${r.id}`, { method: "PATCH", json: { status } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Product"
        title="Releases"
        description="The patch and update calendar: what is planned, what shipped, and which feedback each release resolved."
        actions={
          canManage && (
            <button type="button" className="btn-primary" onClick={() => setDraft(EMPTY)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Plan release
            </button>
          )
        }
      />
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Planned" value={upcoming.length} hint={overdue ? `${overdue} overdue` : "On schedule"} />
        <StatCard label="Shipped (90 days)" value={last90.length} hint={`${last90.filter((r) => r.kind === "hotfix").length} hotfix`} />
        <StatCard label="Last release" value={shipped[0] ? `v${shipped[0].version}` : "—"} hint={shipped[0] ? fmtDate(shipped[0].releasedAt) : undefined} />
        <StatCard label="Feedback resolved by releases" value={shipped.reduce((s, r) => s + r.feedbackDone, 0)} hint="All time" />
      </div>

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <CalendarClock className="h-4 w-4 text-indigo-500" /> Upcoming
        </h2>
        {items === null ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : upcoming.length === 0 ? (
          <Panel>
            <EmptyState title="Nothing planned" body={canManage ? "Plan the next patch so the calendar shows what is coming." : "No releases are scheduled yet."} />
          </Panel>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((r) => {
              const d = r.plannedFor ? daysUntil(r.plannedFor) : null;
              return (
                <Panel key={r.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">v{r.version}</p>
                      <p className="truncate text-sm text-zinc-600 dark:text-zinc-300">{r.title || "Untitled"}</p>
                    </div>
                    <Badge tone={releaseKindTone(r.kind)}>{RELEASE_KINDS[r.kind]}</Badge>
                  </div>
                  <p className="mt-3 text-xs text-zinc-500">
                    {r.plannedFor ? fmtDate(r.plannedFor) : "Date to be decided"}
                    {d != null && (
                      <span className={d < 0 ? "ml-1.5 font-medium text-red-600" : "ml-1.5"}>
                        {d < 0 ? `${-d} day${d === -1 ? "" : "s"} overdue` : d === 0 ? "today" : `in ${d} day${d === 1 ? "" : "s"}`}
                      </span>
                    )}
                  </p>
                  {r.feedbackCount > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] text-zinc-500">
                        <span>Linked feedback</span>
                        <span>
                          {r.feedbackDone}/{r.feedbackCount} done
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(r.feedbackDone / r.feedbackCount) * 100}%` }} />
                      </div>
                    </div>
                  )}
                  {canManage && (
                    <div className="mt-4 flex gap-2">
                      <button type="button" className="btn-primary px-2.5 py-1 text-xs" onClick={() => void setStatus(r, "released")}>
                        <Rocket className="mr-1 h-3.5 w-3.5" /> Mark released
                      </button>
                      <button
                        type="button"
                        className="btn-secondary px-2.5 py-1 text-xs"
                        onClick={() => setDraft({ id: r.id, version: r.version, title: r.title, kind: r.kind, status: r.status, plannedFor: r.plannedFor ?? "", notes: r.notes })}
                      >
                        Edit
                      </button>
                      <button type="button" className="ml-auto text-xs text-zinc-400 hover:text-red-600" onClick={() => void setStatus(r, "cancelled")}>
                        Cancel
                      </button>
                    </div>
                  )}
                </Panel>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Rocket className="h-4 w-4 text-emerald-500" /> Shipped
        </h2>
        {items !== null && shipped.length === 0 ? (
          <Panel>
            <EmptyState title="No releases recorded" body="Mark a planned release as released, or let your deploy pipeline report versions automatically." />
          </Panel>
        ) : (
          <div className="space-y-6">
            {byMonth.map(([month, rows]) => (
              <div key={month}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{month}</p>
                <Panel>
                  <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {rows.map((r) => (
                      <li key={r.id} className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold">v{r.version}</span>
                          <Badge tone={releaseKindTone(r.kind)}>{RELEASE_KINDS[r.kind]}</Badge>
                          {r.source === "ci" && <Badge tone="sky">CI</Badge>}
                          {r.feedbackDone > 0 && <Badge tone="green">Closes {r.feedbackDone} feedback</Badge>}
                          <span className="ml-auto text-xs text-zinc-500">{fmtDate(r.releasedAt)}</span>
                        </div>
                        {r.title && <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">{r.title}</p>}
                        {r.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-500">{r.notes}</p>}
                        {r.commitSha && (
                          <p className="mt-1 flex items-center gap-1 font-mono text-[11px] text-zinc-400">
                            <GitCommitHorizontal className="h-3 w-3" /> {r.commitSha.slice(0, 10)}
                          </p>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            className="mt-1 text-xs text-indigo-600 hover:underline dark:text-indigo-400"
                            onClick={() => setDraft({ id: r.id, version: r.version, title: r.title, kind: r.kind, status: r.status, plannedFor: r.plannedFor ?? "", notes: r.notes })}
                          >
                            Edit notes
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </Panel>
              </div>
            ))}
          </div>
        )}
      </section>

      {canManage && ingestUrl && (
        <Panel>
          <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 text-sm font-medium dark:border-zinc-800">
            <Terminal className="h-4 w-4 text-zinc-400" /> Record releases from your deploy pipeline
          </div>
          <div className="space-y-2 p-5 text-sm text-zinc-600 dark:text-zinc-300">
            <p>
              Add this step after a successful deploy. It uses the project's ingest key; a planned version with the same number is marked released.
            </p>
            <pre className="overflow-x-auto rounded-lg bg-zinc-950 p-3 text-xs text-zinc-100">{`curl -sS -X POST "${ingestUrl}/releases" \\
  -H "X-Monitor-Key: $MONITOR_KEY" -H "Content-Type: application/json" \\
  -d '{"version":"'"$APP_VERSION"'","title":"'"$RELEASE_TITLE"'","commit_sha":"'"$GITHUB_SHA"'"}'`}</pre>
          </div>
        </Panel>
      )}

      {draft && (
        <ReleaseModal
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={async (d) => {
            const body = {
              version: d.version,
              title: d.title,
              kind: d.kind,
              status: d.status,
              plannedFor: d.plannedFor || null,
              notes: d.notes,
            };
            if (d.id) await apiFetch(`${base}/releases/${d.id}`, { method: "PATCH", json: body });
            else await apiFetch(`${base}/releases`, { method: "POST", json: body });
            setDraft(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function ReleaseModal({ draft, onClose, onSave }: { draft: Draft; onClose: () => void; onSave: (d: Draft) => Promise<void> }) {
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <Modal title={draft.id ? `Edit v${draft.version}` : "Plan a release"} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Version">
            <input className="input font-mono" required maxLength={40} value={d.version} onChange={set("version")} placeholder="1.5.0" />
          </Field>
          <Field label="Type">
            <select className="input" value={d.kind} onChange={set("kind")}>
              {Object.entries(RELEASE_KINDS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={d.status} onChange={set("status")}>
              <option value="planned">Planned</option>
              <option value="released">Released</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <Field label="Planned date">
            <input className="input" type="date" value={d.plannedFor} onChange={set("plannedFor")} />
          </Field>
        </div>
        <Field label="Title">
          <input className="input" maxLength={160} value={d.title} onChange={set("title")} placeholder="e.g. Coupon redemption + wallet stability fixes" />
        </Field>
        <Field label="Release notes">
          <textarea className="input min-h-[120px]" maxLength={8000} value={d.notes} onChange={set("notes")} placeholder="What changed for agents, what was fixed" />
        </Field>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
