import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { MessageSquarePlus, Search } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useRange } from "@/org/lib/range";
import { roleAtLeast, orgRoleFor, useAuth } from "@/org/lib/auth";
import { encodeUserKey } from "@/org/lib/journey";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { Badge, EmptyState, Field, Modal, PageHeader, Panel, StatCard } from "@/org/components/ui";
import {
  FEATURE_SUGGESTIONS,
  FEEDBACK_CATEGORIES,
  FEEDBACK_PRIORITIES,
  FEEDBACK_SOURCES,
  FEEDBACK_STATUSES,
  fmtDate,
  fmtHours,
  humanize,
  priorityTone,
  statusTone,
  type FeedbackItem,
  type FeedbackSummary,
  type ReleaseItem,
} from "@/org/lib/productOps";

const STATUS_FILTERS = [
  { id: "open", label: "Open" },
  { id: "", label: "All" },
  ...Object.entries(FEEDBACK_STATUSES).map(([id, label]) => ({ id, label })),
];

const EMPTY_FORM = {
  title: "",
  details: "",
  source: "supervisor",
  category: "request",
  feature: "general",
  priority: "medium",
  reporterName: "",
  reporterContact: "",
  userEmail: "",
};

export function FeedbackPage() {
  const { orgId, projectId } = useParams();
  const { auth } = useAuth();
  const role = orgRoleFor(auth, orgId);
  const canWrite = roleAtLeast(role, "member");
  const { range } = useRange();
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [summary, setSummary] = useState<FeedbackSummary | null>(null);
  const [releases, setReleases] = useState<ReleaseItem[]>([]);
  const [status, setStatus] = useState("open");
  const [feature, setFeature] = useState("");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<FeedbackItem | null>(null);

  const base = `/console/projects/${projectId}`;

  const load = useCallback(async () => {
    if (!projectId) return;
    const q = new URLSearchParams();
    if (status) q.set("status", status);
    if (feature) q.set("feature", feature);
    if (source) q.set("source", source);
    if (search.trim()) q.set("search", search.trim());
    try {
      const [list, sum] = await Promise.all([
        apiFetch<FeedbackItem[]>(`${base}/feedback?${q}`),
        apiFetch<FeedbackSummary>(`${base}/feedback/summary?${range.query}`),
      ]);
      setItems(list);
      setSummary(sum);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load feedback");
    }
  }, [base, projectId, status, feature, source, search, range.query]);

  useEffect(() => {
    const t = window.setTimeout(() => void load(), search ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, search]);

  useEffect(() => {
    if (!projectId) return;
    apiFetch<ReleaseItem[]>(`${base}/releases`).then(setReleases).catch(() => undefined);
  }, [base, projectId]);

  const features = useMemo(() => {
    const set = new Set(FEATURE_SUGGESTIONS);
    for (const f of summary?.byFeature ?? []) set.add(f.feature);
    for (const i of items ?? []) set.add(i.feature);
    return [...set].sort();
  }, [summary, items]);

  async function update(id: string, patch: Record<string, unknown>) {
    try {
      const next = await apiFetch<FeedbackItem>(`${base}/feedback/${id}`, { method: "PATCH", json: patch });
      setSelected(next);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Product"
        title="User feedback"
        description="Feedback from supervisors, support channels and the app itself, routed into the enhancement backlog. Link items to the release that resolves them."
        actions={
          <>
            <TimeRangePicker />
            {canWrite && (
              <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
                <MessageSquarePlus className="mr-1.5 h-4 w-4" />
                Log feedback
              </button>
            )}
          </>
        }
      />

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Received" value={summary?.received ?? "—"} hint={range.label} />
        <StatCard label="Resolved" value={summary?.resolved ?? "—"} hint={range.label} />
        <StatCard label="Open backlog" value={summary?.open ?? "—"} hint="All time" />
        <StatCard label="Median time to resolve" value={fmtHours(summary?.medianResolutionHours ?? null)} hint={range.label} />
      </div>

      {summary && summary.byFeature.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {summary.byFeature.map((f) => (
            <button
              key={f.feature}
              type="button"
              onClick={() => setFeature(feature === f.feature ? "" : f.feature)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                feature === f.feature
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
                  : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-300"
              }`}
            >
              {humanize(f.feature)} <span className="tabular-nums text-zinc-400">{f.open} open / {f.total}</span>
            </button>
          ))}
        </div>
      )}

      <Panel>
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex gap-1 overflow-x-auto">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s.id || "all"}
                type="button"
                onClick={() => setStatus(s.id)}
                className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${
                  status === s.id
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <select className="input w-auto py-1.5 text-xs" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
              <option value="">All channels</option>
              {Object.entries(FEEDBACK_SOURCES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <select className="input w-auto py-1.5 text-xs" value={feature} onChange={(e) => setFeature(e.target.value)} aria-label="Feature">
              <option value="">All features</option>
              {features.map((f) => (
                <option key={f} value={f}>
                  {humanize(f)}
                </option>
              ))}
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400" />
              <input className="input w-48 py-1.5 pl-8 text-xs" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        {items === null ? (
          <p className="p-5 text-sm text-zinc-500">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState
            title="No feedback here"
            body={canWrite ? "Log feedback from supervisors and support, or send it from the app via the ingest API." : "Nothing matches these filters."}
          />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {items.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => setSelected(f)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{f.title}</p>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {FEEDBACK_SOURCES[f.source] ?? f.source}
                      {f.reporterName ? ` · ${f.reporterName}` : ""} · {FEEDBACK_CATEGORIES[f.category] ?? f.category} · {fmtDate(f.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge>{humanize(f.feature)}</Badge>
                    <Badge tone={priorityTone(f.priority)}>{FEEDBACK_PRIORITIES[f.priority]}</Badge>
                    <Badge tone={statusTone(f.status)}>{FEEDBACK_STATUSES[f.status]}</Badge>
                    {f.releaseVersion && <Badge tone="green">v{f.releaseVersion}</Badge>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {creating && (
        <CreateFeedbackModal
          features={features}
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
            await apiFetch(`${base}/feedback`, { method: "POST", json: body });
            setCreating(false);
            await load();
          }}
        />
      )}

      {selected && (
        <FeedbackDetailModal
          item={selected}
          releases={releases}
          features={features}
          canWrite={canWrite}
          userLink={
            selected.userId || selected.userEmail
              ? `/orgs/${orgId}/projects/${projectId}/users/${encodeUserKey(selected.userId, selected.userEmail)}`
              : null
          }
          onClose={() => setSelected(null)}
          onUpdate={(patch) => void update(selected.id, patch)}
        />
      )}
    </div>
  );
}

function CreateFeedbackModal({
  features,
  onClose,
  onCreate,
}: {
  features: string[];
  onClose: () => void;
  onCreate: (body: typeof EMPTY_FORM) => Promise<void>;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY_FORM) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onCreate(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  }

  return (
    <Modal title="Log feedback" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Summary">
          <input className="input" required maxLength={160} value={form.title} onChange={set("title")} placeholder="e.g. Agents can't see delivery fee before placing an order" />
        </Field>
        <Field label="Details">
          <textarea className="input min-h-[96px]" maxLength={4000} value={form.details} onChange={set("details")} placeholder="What happened, where, how often, what the agent expected" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Channel">
            <select className="input" value={form.source} onChange={set("source")}>
              {Object.entries(FEEDBACK_SOURCES)
                .filter(([id]) => id !== "in_app")
                .map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Type">
            <select className="input" value={form.category} onChange={set("category")}>
              {Object.entries(FEEDBACK_CATEGORIES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Feature">
            <input className="input" list="feedback-features" value={form.feature} onChange={set("feature")} />
            <datalist id="feedback-features">
              {features.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </Field>
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={set("priority")}>
              {Object.entries(FEEDBACK_PRIORITIES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Reported by">
            <input className="input" maxLength={120} value={form.reporterName} onChange={set("reporterName")} placeholder="Supervisor / staff name" />
          </Field>
          <Field label="Contact">
            <input className="input" maxLength={120} value={form.reporterContact} onChange={set("reporterContact")} placeholder="Phone or email" />
          </Field>
          <Field label="Affected agent email" hint="Links the item to their journey">
            <input className="input" type="email" maxLength={200} value={form.userEmail} onChange={set("userEmail")} />
          </Field>
        </div>
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

function FeedbackDetailModal({
  item,
  releases,
  features,
  canWrite,
  userLink,
  onClose,
  onUpdate,
}: {
  item: FeedbackItem;
  releases: ReleaseItem[];
  features: string[];
  canWrite: boolean;
  userLink: string | null;
  onClose: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const selectable = releases.filter((r) => r.status !== "cancelled");
  return (
    <Modal title={item.title} onClose={onClose} wide>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{FEEDBACK_SOURCES[item.source] ?? item.source}</Badge>
          <Badge>{FEEDBACK_CATEGORIES[item.category] ?? item.category}</Badge>
          <Badge tone={priorityTone(item.priority)}>{FEEDBACK_PRIORITIES[item.priority]}</Badge>
          <Badge tone={statusTone(item.status)}>{FEEDBACK_STATUSES[item.status]}</Badge>
        </div>
        {item.details ? (
          <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{item.details}</p>
        ) : (
          <p className="text-zinc-400">No details.</p>
        )}
        <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
          <Meta label="Reported by" value={[item.reporterName, item.reporterContact].filter(Boolean).join(" · ") || "—"} />
          <Meta label="Logged" value={`${fmtDate(item.createdAt)}${item.createdBy ? ` by ${item.createdBy}` : ""}`} />
          <Meta
            label="Agent"
            value={
              userLink ? (
                <Link className="text-indigo-600 hover:underline dark:text-indigo-400" to={userLink}>
                  {item.userEmail ?? item.userId}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <Meta label="Resolved" value={fmtDate(item.resolvedAt)} />
        </dl>

        {canWrite ? (
          <div className="grid gap-4 border-t border-zinc-200 pt-4 dark:border-zinc-800 sm:grid-cols-4">
            <Field label="Status">
              <select className="input" value={item.status} onChange={(e) => onUpdate({ status: e.target.value })}>
                {Object.entries(FEEDBACK_STATUSES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priority">
              <select className="input" value={item.priority} onChange={(e) => onUpdate({ priority: e.target.value })}>
                {Object.entries(FEEDBACK_PRIORITIES).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Feature">
              <select className="input" value={item.feature} onChange={(e) => onUpdate({ feature: e.target.value })}>
                {[...new Set([item.feature, ...features])].map((f) => (
                  <option key={f} value={f}>
                    {humanize(f)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Resolved in release">
              <select className="input" value={item.releaseId ?? ""} onChange={(e) => onUpdate({ releaseId: e.target.value || null })}>
                <option value="">Not linked</option>
                {selectable.map((r) => (
                  <option key={r.id} value={r.id}>
                    v{r.version} {r.status === "planned" ? "(planned)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          item.releaseVersion && <p className="text-xs text-zinc-500">Resolved in v{item.releaseVersion}</p>
        )}
      </div>
    </Modal>
  );
}

function Meta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-zinc-400">{label}</dt>
      <dd className="text-zinc-800 dark:text-zinc-200">{value}</dd>
    </div>
  );
}
