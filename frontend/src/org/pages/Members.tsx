import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useAuth } from "@/org/lib/auth";
import type { OrgRole, ProjectListItem } from "@/org/types";
import { EmptyState, PageHeader, Panel } from "@/org/components/ui";
import { TempPasswordNotice, type Provisioned } from "@/org/components/TempPasswordNotice";

type Member = {
  id: string;
  email: string;
  name: string | null;
  role: OrgRole;
  createdAt: string;
  pendingFirstLogin: boolean;
  projectIds: string[];
};

const ROLE_LABEL: Record<string, string> = {
  owner: "Admin (owner)",
  admin: "Organization admin",
  member: "Member",
  viewer: "Viewer",
};

type FormState = {
  email: string;
  name: string;
  role: "admin" | "viewer";
  projectIds: string[];
};

const EMPTY_FORM: FormState = {
  email: "",
  name: "",
  role: "viewer",
  projectIds: [],
};

export function MembersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { auth } = useAuth();
  const [orgName, setOrgName] = useState("Organization");
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [provisioned, setProvisioned] = useState<Provisioned | null>(null);
  const [drawer, setDrawer] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");

  async function load() {
    if (!orgId) return;
    const [m, p, o] = await Promise.all([
      apiFetch<Member[]>(`/console/organizations/${orgId}/members`),
      apiFetch<ProjectListItem[]>(`/console/organizations/${orgId}/projects`),
      apiFetch<{ name: string }>(`/console/organizations/${orgId}`),
    ]);
    setMembers(m);
    setProjects(p);
    setOrgName(o.name);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [orgId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.email.toLowerCase().includes(q) ||
        (m.name ?? "").toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
    );
  }, [members, search]);

  function openCreate() {
    setEditing(null);
    setForm({
      ...EMPTY_FORM,
      projectIds: projects[0] ? [projects[0].id] : [],
    });
    setDrawer("create");
    setError(null);
  }

  function openEdit(m: Member) {
    setEditing(m);
    setForm({
      email: m.email,
      name: m.name ?? "",
      role: m.role === "viewer" ? "viewer" : "admin",
      projectIds: m.projectIds ?? [],
    });
    setDrawer("edit");
    setError(null);
  }

  function toggleProject(id: string) {
    setForm((prev) => ({
      ...prev,
      projectIds: prev.projectIds.includes(id)
        ? prev.projectIds.filter((x) => x !== id)
        : [...prev.projectIds, id],
    }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    if (form.role === "viewer" && form.projectIds.length === 0) {
      setError("Viewers need at least one project assigned");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (drawer === "create") {
        const res = await apiFetch<{
          email: string;
          created: boolean;
          temporaryPassword: string | null;
        }>(`/console/organizations/${orgId}/members`, {
          method: "POST",
          json: {
            email: form.email,
            name: form.name || undefined,
            role: form.role,
            projectIds: form.role === "viewer" ? form.projectIds : [],
          },
        });
        if (res.created && res.temporaryPassword) {
          setProvisioned({ email: res.email, temporaryPassword: res.temporaryPassword });
        }
      } else if (editing) {
        await apiFetch(`/console/organizations/${orgId}/members/${editing.id}`, {
          method: "PATCH",
          json: {
            role: form.role,
            name: form.name || null,
            projectIds: form.role === "viewer" ? form.projectIds : [],
          },
        });
      }
      setDrawer(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function onRemove(m: Member) {
    if (!orgId) return;
    if (!window.confirm(`Remove ${m.email} from ${orgName}?`)) return;
    setError(null);
    try {
      await apiFetch(`/console/organizations/${orgId}/members/${m.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    }
  }

  async function onReset(m: Member) {
    if (!orgId) return;
    setError(null);
    try {
      const res = await apiFetch<Provisioned>(
        `/console/organizations/${orgId}/members/${m.id}/reset-password`,
        { method: "POST" }
      );
      setProvisioned(res);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reset failed");
    }
  }

  function projectNames(ids: string[]) {
    if (!ids.length) return "All projects";
    return ids
      .map((id) => projects.find((p) => p.id === id)?.name ?? "Project")
      .join(", ");
  }

  return (
    <div className="relative">
      <Link
        to={`/orgs/${orgId}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-indigo-600 dark:text-indigo-400"
      >
        <ArrowLeft className="h-4 w-4" />
        {orgName}
      </Link>

      <PageHeader
        eyebrow="Organization"
        title="Members"
        description={`Manage who can access ${orgName}. Viewers are limited to the projects you assign.`}
        actions={
          <button type="button" className="btn-primary" onClick={openCreate}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            Add member
          </button>
        }
      />

      {error && !drawer && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {provisioned && (
        <TempPasswordNotice value={provisioned} onDismiss={() => setProvisioned(null)} />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          className="input max-w-sm"
          placeholder="Search by email, name, or role…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <p className="text-xs text-zinc-500">
          {members.length} member{members.length === 1 ? "" : "s"}
        </p>
      </div>

      <Panel>
        {filtered.length === 0 ? (
          <EmptyState
            title={search ? "No matches" : "No members yet"}
            body={
              search
                ? "Try a different search."
                : "Add an organization admin or a viewer with project access."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="table-head">
                <tr>
                  <th className="px-5 py-3">Person</th>
                  <th className="px-5 py-3">Role</th>
                  <th className="px-5 py-3">Projects</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const isSelf = m.email === auth.email;
                  return (
                    <tr
                      key={m.id}
                      className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500/15 text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                            {(m.name || m.email).charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                              {m.name || m.email}
                              {isSelf && (
                                <span className="ml-2 text-xs font-normal text-zinc-400">you</span>
                              )}
                            </p>
                            {m.name && (
                              <p className="truncate text-xs text-zinc-500">{m.email}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                          {ROLE_LABEL[m.role] ?? m.role}
                        </span>
                      </td>
                      <td className="max-w-[14rem] px-5 py-4 text-xs text-zinc-600 dark:text-zinc-400">
                        {m.role === "viewer" ? projectNames(m.projectIds) : "All projects"}
                      </td>
                      <td className="px-5 py-4 text-xs">
                        {m.pendingFirstLogin ? (
                          <span className="text-amber-700 dark:text-amber-400">Awaiting first sign-in</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400">Active</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800"
                            title="Edit"
                            onClick={() => openEdit(m)}
                            disabled={isSelf}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800"
                            title="Reset password"
                            onClick={() => void onReset(m)}
                            disabled={isSelf}
                          >
                            <KeyRound className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            className="rounded-lg p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                            title="Remove"
                            onClick={() => void onRemove(m)}
                            disabled={isSelf}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-zinc-950/40"
            aria-label="Close"
            onClick={() => setDrawer(null)}
          />
          <aside className="relative flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
                  {drawer === "create" ? "New member" : "Edit member"}
                </p>
                <h2 className="text-base font-semibold">
                  {drawer === "create" ? "Add to organization" : editing?.email}
                </h2>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                onClick={() => setDrawer(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <form onSubmit={onSubmit} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
                {drawer === "create" && (
                  <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Email
                    <input
                      className="input mt-1"
                      type="email"
                      required
                      autoFocus
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="person@company.com"
                    />
                  </label>
                )}
                <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  Display name
                  <input
                    className="input mt-1"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Optional"
                  />
                </label>

                <fieldset>
                  <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Role
                  </legend>
                  <div className="mt-2 space-y-2">
                    {(
                      [
                        {
                          value: "admin" as const,
                          title: "Organization admin",
                          body: "Manage projects, members, keys, and settings",
                        },
                        {
                          value: "viewer" as const,
                          title: "Viewer",
                          body: "Read-only dashboards for assigned projects only",
                        },
                      ] as const
                    ).map((opt) => (
                      <label
                        key={opt.value}
                        className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                          form.role === opt.value
                            ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500/30 dark:border-indigo-400 dark:bg-indigo-500/10"
                            : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-800"
                        }`}
                      >
                        <input
                          type="radio"
                          className="mt-1"
                          name="role"
                          checked={form.role === opt.value}
                          onChange={() => setForm((f) => ({ ...f, role: opt.value }))}
                        />
                        <span>
                          <span className="block text-sm font-medium">{opt.title}</span>
                          <span className="text-xs text-zinc-500">{opt.body}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                {form.role === "viewer" && (
                  <fieldset>
                    <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      Assigned projects
                    </legend>
                    {projects.length === 0 ? (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                        Create a project first, then assign the viewer.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-2">
                        {projects.map((p) => (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800"
                          >
                            <input
                              type="checkbox"
                              checked={form.projectIds.includes(p.id)}
                              onChange={() => toggleProject(p.id)}
                            />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{p.name}</span>
                              <span className="text-xs text-zinc-500">{p.platform}</span>
                            </span>
                          </label>
                        ))}
                      </ul>
                    )}
                  </fieldset>
                )}

                {error && drawer && <p className="text-sm text-red-600">{error}</p>}
              </div>

              <footer className="flex gap-2 border-t border-zinc-200 px-5 py-4 dark:border-zinc-800">
                <button type="button" className="btn-secondary flex-1" onClick={() => setDrawer(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary flex-1" disabled={busy}>
                  {busy ? "Saving…" : drawer === "create" ? (
                    <>
                      <Plus className="mr-1 h-4 w-4" />
                      Add member
                    </>
                  ) : (
                    "Save changes"
                  )}
                </button>
              </footer>
            </form>
          </aside>
        </div>
      )}

      {members.length === 0 && !drawer && (
        <div className="pointer-events-none fixed bottom-8 right-8 hidden opacity-20 lg:block">
          <Users className="h-32 w-32" />
        </div>
      )}
    </div>
  );
}
