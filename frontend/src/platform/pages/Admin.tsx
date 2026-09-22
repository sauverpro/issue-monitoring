import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "@/org/lib/api";
import { PageHeader, Panel } from "@/org/components/ui";
import { TempPasswordNotice, type Provisioned } from "@/org/components/TempPasswordNotice";

type Org = {
  id: string;
  name: string;
  slug: string;
  suspended: boolean;
  projectCount: number;
  events7d: number;
};

export function PlatformAdminPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [name, setName] = useState("");
  const [inviteOrgId, setInviteOrgId] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<Provisioned | null>(null);

  async function load() {
    const list = await apiFetch<Org[]>("/console/admin/organizations");
    setOrgs(list);
    if (!inviteOrgId && list[0]) setInviteOrgId(list[0].id);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Admin only"));
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await apiFetch<{ id: string; name: string }>("/console/admin/organizations", {
        method: "POST",
        json: { name },
      });
      setName("");
      setInviteOrgId(created.id);
      setNotice(
        `Created ${created.name}. Invite an owner so they can open the organization workspace.`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteOrgId) return;
    setError(null);
    setNotice(null);
    setProvisioned(null);
    try {
      const res = await apiFetch<{
        email: string;
        created: boolean;
        temporaryPassword: string | null;
      }>(`/console/organizations/${inviteOrgId}/members`, {
        method: "POST",
        json: { email: inviteEmail, role: "admin" },
      });
      setInviteEmail("");
      if (res.created && res.temporaryPassword) {
        setProvisioned({ email: res.email, temporaryPassword: res.temporaryPassword });
      } else {
        setNotice(`${res.email} is now an organization admin. They sign in at /login.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Platform admin"
        title="Organizations"
        description="Create tenants and invite the first organization admin. Platform admins are not members of those orgs. Admins manage projects and viewers in the organization workspace."
      />
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
      {provisioned && (
        <TempPasswordNotice value={provisioned} onDismiss={() => setProvisioned(null)} />
      )}
      <form className="mb-4 flex max-w-lg gap-2" onSubmit={(e) => void onCreate(e)}>
        <input
          className="input flex-1"
          placeholder="Create organization"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn-primary">Create</button>
      </form>
      <form className="mb-6 flex max-w-xl flex-wrap items-end gap-2" onSubmit={(e) => void onInvite(e)}>
        <label className="text-xs font-medium text-zinc-500">
          Organization
          <select
            className="input mt-1 w-48"
            value={inviteOrgId}
            onChange={(e) => setInviteOrgId(e.target.value)}
            required
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[12rem] flex-1 text-xs font-medium text-zinc-500">
          Organization admin email
          <input
            className="input mt-1"
            type="email"
            placeholder="owner@org.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
        </label>
        <button className="btn-secondary">Invite owner</button>
      </form>
      <Panel>
        <table className="w-full text-left text-sm">
          <thead className="table-head">
            <tr>
              <th className="px-5 py-2">Org</th>
              <th className="px-5 py-2">Projects</th>
              <th className="px-5 py-2">Events (7d)</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-b border-zinc-100 dark:border-zinc-800">
                <td className="px-5 py-3">
                  <Link
                    className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    to={`/orgs/${o.id}`}
                  >
                    {o.name}
                  </Link>{" "}
                  {o.suspended ? (
                    <span className="text-xs text-red-600">(suspended)</span>
                  ) : null}
                </td>
                <td className="px-5 py-3 tabular-nums">{o.projectCount}</td>
                <td className="px-5 py-3 tabular-nums">{o.events7d}</td>
                <td className="px-5 py-3">
                  <button
                    type="button"
                    className="text-indigo-600 dark:text-indigo-400"
                    onClick={() => {
                      const path = o.suspended
                        ? `/console/admin/organizations/${o.id}/unsuspend`
                        : `/console/admin/organizations/${o.id}/suspend`;
                      void apiFetch(path, { method: "POST" }).then(() => load());
                    }}
                  >
                    {o.suspended ? "Unsuspend" : "Suspend"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
