import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { Badge, EmptyState, Field, Modal, Panel } from "@/org/components/ui";
import {
  fmtDurationMs,
  humanize,
  type FunnelDef,
  type FunnelResult,
  type FunnelStepDef,
  type StoredFunnel,
} from "@/org/lib/productOps";

/** Validation errors arrive as JSON; show a plain hint instead. */
function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : "";
  return !m || m.startsWith("{") ? "Give the funnel a name and every step a label plus a screen or path (2–8 steps)." : m;
}

const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.1 ? 1 : 0)}%`;

function completionTone(rate: number, started: number) {
  if (!started) return "neutral" as const;
  if (rate >= 0.5) return "green" as const;
  if (rate >= 0.2) return "amber" as const;
  return "red" as const;
}

export function FeatureFunnels({ projectId, query, canManage }: { projectId: string; query: string; canManage: boolean }) {
  const base = `/console/projects/${projectId}/feature-funnels`;
  const [funnels, setFunnels] = useState<StoredFunnel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<(FunnelDef & { id?: string }) | "pick" | null>(null);

  const load = useCallback(async () => {
    try {
      setFunnels(await apiFetch<StoredFunnel[]>(`${base}?${query}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load funnels");
    }
  }, [base, query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: string) {
    if (!window.confirm("Delete this funnel?")) return;
    await apiFetch(`${base}/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <section className="mb-10">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Feature adoption</h2>
          <p className="text-xs text-zinc-500">
            How many agents who start each business flow complete it. Steps count only when reached after the previous step.
          </p>
        </div>
        {canManage && (
          <button type="button" className="btn-secondary" onClick={() => setEditing("pick")}>
            <Plus className="mr-1.5 h-4 w-4" /> Add funnel
          </button>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {funnels === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : funnels.length === 0 ? (
        <Panel>
          <EmptyState
            title="No feature funnels yet"
            body={canManage ? "Add the ordering, contracting and coupon flows from the templates to start tracking adoption." : "An admin can define funnels for key flows."}
          />
        </Panel>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {funnels.map((f) => (
            <FunnelCard
              key={f.id}
              funnel={f}
              canManage={canManage}
              onEdit={() => setEditing({ id: f.id, name: f.name, feature: f.feature, description: f.description, steps: f.steps })}
              onDelete={() => void remove(f.id)}
            />
          ))}
        </div>
      )}

      {editing === "pick" && (
        <TemplatePicker
          base={base}
          onClose={() => setEditing(null)}
          onPick={(t) => setEditing(t)}
        />
      )}
      {editing && editing !== "pick" && (
        <FunnelEditor
          base={base}
          query={query}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

function FunnelCard({
  funnel,
  canManage,
  onEdit,
  onDelete,
}: {
  funnel: StoredFunnel;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const r = funnel.result;
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-semibold">
            {funnel.name} <Badge>{humanize(funnel.feature)}</Badge>
          </p>
          {funnel.description && <p className="mt-0.5 text-xs text-zinc-500">{funnel.description}</p>}
        </div>
        <div className="text-right">
          <Badge tone={completionTone(r.completionRate, r.started)}>{r.started ? `${pct(r.completionRate)} complete` : "No data"}</Badge>
          <p className="mt-1 text-[11px] text-zinc-500">median {fmtDurationMs(r.medianCompletionMs)}</p>
        </div>
      </div>
      <FunnelBars result={r} />
      {canManage && (
        <div className="flex justify-end gap-3 border-t border-zinc-100 px-5 py-2 text-xs dark:border-zinc-800">
          <button type="button" className="text-indigo-600 hover:underline dark:text-indigo-400" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="text-zinc-400 hover:text-red-600" onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </Panel>
  );
}

function FunnelBars({ result }: { result: FunnelResult }) {
  const max = Math.max(1, result.started);
  return (
    <div className="space-y-2.5 px-5 py-4">
      {result.steps.map((s, i) => (
        <div key={`${s.label}-${i}`}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate">
              <span className="mr-1.5 text-zinc-400">{i + 1}.</span>
              {s.label}
            </span>
            <span className="flex shrink-0 items-center gap-2 tabular-nums text-zinc-500">
              {s.failedUsers > 0 && (
                <span className="inline-flex items-center gap-0.5 text-amber-600" title="Attempted after the previous step but the call never succeeded">
                  <AlertTriangle className="h-3 w-3" /> {s.failedUsers} failed
                </span>
              )}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{s.users.toLocaleString()}</span>
              {i > 0 && <span>{pct(s.conversionFromPrev)} of prev</span>}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(s.users / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {result.biggestDrop && (
        <p className="pt-1 text-xs text-zinc-500">
          Biggest drop: <span className="font-medium text-zinc-700 dark:text-zinc-300">{result.biggestDrop.from}</span> →{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{result.biggestDrop.to}</span> ({result.biggestDrop.lost.toLocaleString()} users,{" "}
          {pct(result.biggestDrop.rate)})
        </p>
      )}
    </div>
  );
}

function TemplatePicker({
  base,
  onClose,
  onPick,
}: {
  base: string;
  onClose: () => void;
  onPick: (f: FunnelDef) => void;
}) {
  const [templates, setTemplates] = useState<(FunnelDef & { key: string })[]>([]);
  useEffect(() => {
    apiFetch<(FunnelDef & { key: string })[]>(`${base}/templates`).then(setTemplates).catch(() => undefined);
  }, [base]);
  return (
    <Modal title="Add a feature funnel" onClose={onClose} wide>
      <p className="mb-4 text-sm text-zinc-500">Start from a Marketplace flow and adjust it, or build one from scratch.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onPick({ name: t.name, feature: t.feature, description: t.description, steps: t.steps })}
            className="rounded-xl border border-zinc-200 p-3 text-left transition hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-zinc-700 dark:hover:bg-indigo-500/10"
          >
            <p className="text-sm font-medium">{t.name}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{t.description}</p>
            <p className="mt-2 text-[11px] text-zinc-400">{t.steps.map((s) => s.label).join(" → ")}</p>
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            onPick({
              name: "",
              feature: "general",
              description: "",
              steps: [
                { type: "screen", label: "", match: "prefix", value: "" },
                { type: "api", label: "", method: "POST", path: "", successOnly: true },
              ],
            })
          }
          className="rounded-xl border border-dashed border-zinc-300 p-3 text-left text-sm text-zinc-500 hover:border-indigo-400 dark:border-zinc-700"
        >
          <Plus className="mb-1 h-4 w-4" />
          Custom funnel
        </button>
      </div>
    </Modal>
  );
}

function FunnelEditor({
  base,
  query,
  initial,
  onClose,
  onSaved,
}: {
  base: string;
  query: string;
  initial: FunnelDef & { id?: string };
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [def, setDef] = useState<FunnelDef>({ name: initial.name, feature: initial.feature, description: initial.description, steps: initial.steps });
  const [preview, setPreview] = useState<FunnelResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setStep = (i: number, s: FunnelStepDef) => setDef((d) => ({ ...d, steps: d.steps.map((x, j) => (j === i ? s : x)) }));
  const move = (i: number, dir: -1 | 1) =>
    setDef((d) => {
      const steps = [...d.steps];
      const j = i + dir;
      if (j < 0 || j >= steps.length) return d;
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...d, steps };
    });

  async function runPreview() {
    setError(null);
    try {
      setPreview(await apiFetch<FunnelResult>(`${base}/preview?${query}`, { method: "POST", json: def }));
    } catch (e) {
      setError(friendly(e));
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (initial.id) await apiFetch(`${base}/${initial.id}`, { method: "PUT", json: def });
      else await apiFetch(base, { method: "POST", json: def });
      await onSaved();
    } catch (e) {
      setError(friendly(e));
      setBusy(false);
    }
  }

  return (
    <Modal title={initial.id ? "Edit funnel" : "New funnel"} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name">
            <input className="input" maxLength={80} value={def.name} onChange={(e) => setDef({ ...def, name: e.target.value })} />
          </Field>
          <Field label="Feature">
            <input className="input" maxLength={40} value={def.feature} onChange={(e) => setDef({ ...def, feature: e.target.value })} />
          </Field>
          <Field label="Description">
            <input className="input" maxLength={400} value={def.description} onChange={(e) => setDef({ ...def, description: e.target.value })} />
          </Field>
        </div>

        <div className="space-y-2">
          {def.steps.map((s, i) => (
            <div key={i} className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="flex flex-wrap items-end gap-2">
                <span className="pb-2 text-xs font-semibold text-zinc-400">{i + 1}</span>
                <div className="w-28">
                  <Field label="Matches">
                    <select
                      className="input"
                      value={s.type}
                      onChange={(e) =>
                        setStep(
                          i,
                          e.target.value === "screen"
                            ? { type: "screen", label: s.label, match: "prefix", value: "" }
                            : { type: "api", label: s.label, method: "POST", path: "", successOnly: true }
                        )
                      }
                    >
                      <option value="screen">Screen</option>
                      <option value="api">API call</option>
                    </select>
                  </Field>
                </div>
                <div className="min-w-[140px] flex-1">
                  <Field label="Step label">
                    <input className="input" maxLength={80} value={s.label} onChange={(e) => setStep(i, { ...s, label: e.target.value })} />
                  </Field>
                </div>
                {s.type === "screen" ? (
                  <>
                    <div className="w-28">
                      <Field label="Rule">
                        <select className="input" value={s.match} onChange={(e) => setStep(i, { ...s, match: e.target.value as "exact" | "prefix" | "contains" })}>
                          <option value="prefix">Starts with</option>
                          <option value="exact">Equals</option>
                          <option value="contains">Contains</option>
                        </select>
                      </Field>
                    </div>
                    <div className="min-w-[160px] flex-1">
                      <Field label="Screen">
                        <input className="input font-mono" value={s.value} onChange={(e) => setStep(i, { ...s, value: e.target.value })} placeholder="/request-product" />
                      </Field>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-24">
                      <Field label="Method">
                        <select className="input" value={s.method ?? ""} onChange={(e) => setStep(i, { ...s, method: e.target.value || undefined })}>
                          <option value="">Any</option>
                          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </Field>
                    </div>
                    <div className="min-w-[160px] flex-1">
                      <Field label="Path ({id} = any segment)">
                        <input className="input font-mono" value={s.path} onChange={(e) => setStep(i, { ...s, path: e.target.value })} placeholder="/stock-orders/{id}/received" />
                      </Field>
                    </div>
                    <label className="flex items-center gap-1.5 pb-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <input type="checkbox" checked={s.successOnly} onChange={(e) => setStep(i, { ...s, successOnly: e.target.checked })} />
                      Success only
                    </label>
                  </>
                )}
                <div className="flex gap-1 pb-1.5">
                  <button type="button" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => move(i, -1)} aria-label="Move up">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => move(i, 1)} aria-label="Move down">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    disabled={def.steps.length <= 2}
                    onClick={() => setDef({ ...def, steps: def.steps.filter((_, j) => j !== i) })}
                    aria-label="Remove step"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {def.steps.length < 8 && (
            <button
              type="button"
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
              onClick={() => setDef({ ...def, steps: [...def.steps, { type: "api", label: "", method: "POST", path: "", successOnly: true }] })}
            >
              + Add step
            </button>
          )}
        </div>

        {preview && (
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700">
            <p className="border-b border-zinc-200 px-5 py-2 text-xs font-medium text-zinc-500 dark:border-zinc-700">
              Preview for the selected period · {preview.started ? `${pct(preview.completionRate)} complete` : "no users matched step 1"}
            </p>
            <FunnelBars result={preview} />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => void runPreview()}>
            Preview
          </button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save funnel"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
