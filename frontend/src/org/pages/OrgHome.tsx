import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronRight, Globe, Smartphone, Users } from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { useAuth, orgHomePath, orgRoleFor, roleAtLeast } from "@/org/lib/auth";
import type { ProjectListItem } from "@/org/types";
import { EmptyState, PageHeader, Panel } from "@/org/components/ui";

export function OrgHomePage() {
  const { orgId } = useParams<{ orgId: string }>();
  const { auth } = useAuth();
  const membership = auth.orgs.find((o) => o.id === orgId) ?? auth.org;
  const canManage = roleAtLeast(orgRoleFor(auth, orgId), "admin");
  const isViewer = orgRoleFor(auth, orgId) === "viewer";

  const [org, setOrg] = useState<{
    name: string;
    slug: string;
    role: string;
    suspended: boolean;
  } | null>(
    membership
      ? {
          name: membership.name,
          slug: membership.slug,
          role: membership.role,
          suspended: membership.suspended,
        }
      : null
  );
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<"react-native" | "web">("react-native");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!orgId) return;
    const [p, o] = await Promise.all([
      apiFetch<ProjectListItem[]>(`/console/organizations/${orgId}/projects`),
      apiFetch<{ name: string; slug: string; role: string; suspended: boolean }>(
        `/console/organizations/${orgId}`
      ),
    ]);
    setProjects(p);
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={isViewer ? org?.name : "Organization"}
        title={isViewer ? "Your projects" : (org?.name ?? "Your organization")}
        description={
          isViewer
            ? `Signed in to ${org?.name ?? "your organization"} · read-only access to the projects below`
            : org
              ? `${org.slug}${org.suspended ? " · suspended" : ""} · ${projects.length} project${projects.length === 1 ? "" : "s"}`
              : "Projects for your organization."
        }
        actions={
          canManage ? (
            <Link to={`/orgs/${orgId}/members`} className="btn-secondary">
              <Users className="mr-1.5 h-4 w-4" />
              Members
            </Link>
          ) : undefined
        }
      />
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section>
        {!isViewer && (
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Projects
          </h2>
        )}
        {canManage && (
          <form onSubmit={onCreate} className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-xs font-medium text-zinc-500">
              Name
              <input
                className="input mt-1 w-56"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
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
        )}
        <Panel>
          {projects.length === 0 ? (
            <EmptyState
              title="No projects"
              body={
                canManage
                  ? "Create a React Native or web project to get an ingest key."
                  : "You have not been assigned to any projects yet. Ask your organization admin."
              }
            />
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link
                    to={`/orgs/${orgId}/projects/${p.id}/overview`}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      {p.platform === "web" ? (
                        <Globe className="h-5 w-5" />
                      ) : (
                        <Smartphone className="h-5 w-5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-zinc-500">
                        {p.platform} · {p.hostCount} hosts
                        {org?.name && isViewer ? ` · ${org.name}` : ""}
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
    </div>
  );
}
