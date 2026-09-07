import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { PageHeader, Panel } from "@/org/components/ui";

type KeyRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

type Upstream = { id: string; slug: string; host: string; label: string };

export function SettingsPage() {
  const { projectId } = useParams();
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [upstreams, setUpstreams] = useState<Upstream[]>([]);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!projectId) return;
    try {
      const [k, u] = await Promise.all([
        apiFetch<KeyRow[]>(`/console/projects/${projectId}/keys`),
        apiFetch<Upstream[]>(`/console/projects/${projectId}/upstreams`),
      ]);
      setKeys(k);
      setUpstreams(u);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load settings");
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function createKey() {
    if (!projectId) return;
    const res = await apiFetch<{ key: string }>(`/console/projects/${projectId}/keys`, {
      method: "POST",
      json: { name: "ingest" },
    });
    setNewKey(res.key);
    await load();
  }

  async function revoke(id: string) {
    if (!projectId) return;
    await apiFetch(`/console/projects/${projectId}/keys/${id}/revoke`, { method: "POST" });
    await load();
  }

  async function addHost(e: FormEvent) {
    e.preventDefault();
    if (!projectId) return;
    await apiFetch(`/console/projects/${projectId}/upstreams`, {
      method: "POST",
      json: { slug, host },
    });
    setSlug("");
    setHost("");
    await load();
  }

  async function removeHost(id: string) {
    if (!projectId) return;
    await apiFetch(`/console/projects/${projectId}/upstreams/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Project"
        title="Settings"
        description="Rotate ingest keys. Upstream hosts label Overview / APIs; every HTTP call is stored (success and failure) with request/response bodies."
      />
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ingest API keys</h2>
          <button type="button" onClick={() => void createKey().catch((e) => setError(e.message))} className="btn-primary">
            Create key
          </button>
        </div>
        {newKey && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
            <p className="font-medium">Store this key now. It will not be shown again.</p>
            <code className="mt-2 block break-all rounded-lg bg-white/80 p-2 text-xs dark:bg-zinc-950">{newKey}</code>
          </div>
        )}
        <Panel>
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {keys.map((k) => (
              <li key={k.id} className="flex items-center justify-between px-5 py-3">
                <span>
                  <span className="font-medium">{k.name}</span>
                  <span className="text-zinc-500"> · {k.prefix}…</span>
                  {k.revokedAt ? <span className="text-red-600"> (revoked)</span> : null}
                </span>
                {!k.revokedAt && (
                  <button type="button" className="text-sm text-red-600" onClick={() => void revoke(k.id)}>
                    Revoke
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Allowed upstream hosts</h2>
        <form onSubmit={addHost} className="flex flex-wrap gap-2">
          <input className="input w-40" placeholder="SLUG" value={slug} onChange={(e) => setSlug(e.target.value)} required />
          <input
            className="input w-64"
            placeholder="host (e.g. openapi.gwiza.tech)"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            required
          />
          <button className="btn-secondary">Add</button>
        </form>
        <Panel>
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {upstreams.map((u) => (
              <li key={u.id} className="flex items-center justify-between px-5 py-3">
                <span>
                  <span className="font-medium">{u.slug}</span>
                  <span className="text-zinc-500"> · {u.host}</span>
                </span>
                <button type="button" className="text-red-600" onClick={() => void removeHost(u.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </div>
  );
}
