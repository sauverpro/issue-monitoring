import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronRight, Smartphone, Globe } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useAuth, orgHomePath } from "@/org/lib/auth";
import type { ProjectListItem } from "@/org/types";
import { EmptyState, PageHeader, Panel } from "@/org/components/ui";

type Member = { id: string; email: string; name: string | null; role: string };

export function OrgHomePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { auth } = useAuth();
  const membership = auth.orgs.find((o) => o.id === orgId) ?? auth.org;
  const [org, setOrg] = useState<{
    name: string;
    slug: string;
    role: string;
    suspended: boolean;
  } | null>(membership ? { name: membership.name, slug: membership.slug, role: membership.role, suspended: membership.suspended } : null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<"react-native" | "web">("react-native");
  const [inviteEmail, setInviteEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!orgId) return;
    const [p, m, o] = await Promise.all([
      apiFetch<ProjectListItem[]>(`/console/organizations/${orgId}/projects`),
      apiFetch<Member[]>(`/console/organizations/${orgId}/members`),
      apiFetch<{ name: string; slug: string; role: string; suspended: boolean }>(
        `/console/organizations/${orgId}`
      ),
    ]);
    setProjects(p);
    setMembers(m);
    setOrg(o);
  }

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, [orgId]);

  const allowed =
    auth.isPlatformAdmin || auth.orgs.some((o) => o.id === orgId) || auth.orgs.length === 0;
  if (auth.ready && orgId && !allowed && auth.org) {
    return <Navigate to={orgHomePath(auth.org)} replace />;
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    try {
      await apiFetch(`/console/organizations/${orgId}/projects`, {
        method: "POST",
        json: { name, platform },
      });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    try {
      await apiFetch(`/console/organizations/${orgId}/members`, {
        method: "POST",
        json: { email: inviteEmail, role: "member" },
      });
      setInviteEmail("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite failed");
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization"
        title={org?.name ?? "Your organization"}
        description={
          org
            ? `${org.slug} · ${org.role}${org.suspended ? " · suspended" : ""} · ${projects.length} project${projects.length === 1 ? "" : "s"} · ${members.length} member${members.length === 1 ? "" : "s"}`
            : "Projects and members for your organization."
        }
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Projects</h2>
      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
        <label className="text-xs font-medium text-zinc-500">
          Name
          <input className="input mt-1 w-56" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Platform
          <select
            className="input mt-1 w-44"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as "react-native" | "web")}
          >
            <option value="react-native">React Native</option>
            <option value="web">Web</option>
          </select>
        </label>
        <button className="btn-primary">Create project</button>
      </form>
      <Panel>
        {projects.length === 0 ? (
          <EmptyState title="No projects" body="Create a React Native or web project to get an ingest key." />
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  to={`/orgs/${orgId}/projects/${p.id}/overview`}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {p.platform === "web" ? <Globe className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-zinc-500">
                      {p.platform} · {p.hostCount} hosts
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">Members</h2>
        <form onSubmit={onInvite} className="mb-3 flex max-w-md gap-2">
          <input
            className="input flex-1"
            type="email"
            placeholder="Invite by registered email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
          <button className="btn-secondary">Invite</button>
        </form>
        <Panel>
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800 text-sm">
            {members.map((m) => (
              <li key={m.id} className="flex items-center justify-between px-5 py-3">
                <span>{m.email}</span>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </div>
  );
}
