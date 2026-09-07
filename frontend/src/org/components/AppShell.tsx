import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Filter,
  FolderKanban,
  Gauge,
  Globe,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MousePointerClick,
  Package,
  Plug,
  Route,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import { useAuth, orgHomePath } from "@/org/lib/auth";
import { apiFetch } from "@/org/lib/api";
import { RangeProvider } from "@/org/lib/range";
import { TimeRangePicker } from "@/org/components/TimeRangePicker";
import { ThemeToggle } from "./ThemeToggle";
import type { OrgListItem, ProjectListItem } from "@/org/types";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

function NavSection({
  title,
  items,
  collapsed,
}: {
  title: string;
  items: NavItem[];
  collapsed: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      {!collapsed && (
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400 dark:text-zinc-500">
          {title}
        </p>
      )}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          title={collapsed ? item.label : undefined}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-indigo-500/10 text-indigo-700 ring-1 ring-indigo-500/20 dark:text-indigo-300"
                : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-100",
              collapsed && "justify-center px-2"
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="truncate">{item.label}</span>}
        </NavLink>
      ))}
    </div>
  );
}

function AppShellInner({ children }: { children: ReactNode }) {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { orgId, projectId } = useParams();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectName, setProjectName] = useState<string | null>(null);

  const currentOrg: OrgListItem | null =
    auth.orgs.find((o) => o.id === orgId) ?? (orgId ? null : auth.org);

  const home = orgHomePath(currentOrg ?? auth.org);
  const projectBase = orgId && projectId ? `/orgs/${orgId}/projects/${projectId}` : null;

  useEffect(() => {
    if (!orgId) {
      setProjects([]);
      return;
    }
    void apiFetch<ProjectListItem[]>(`/console/organizations/${orgId}/projects`)
      .then(setProjects)
      .catch(() => undefined);
  }, [orgId]);

  useEffect(() => {
    if (!projectId) {
      setProjectName(null);
      return;
    }
    void apiFetch<{ name: string }>(`/console/projects/${projectId}`)
      .then((p) => setProjectName(p.name))
      .catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const orgNav: NavItem[] = orgId
    ? [{ to: `/orgs/${orgId}`, label: "Organization", icon: FolderKanban, end: true }]
    : [];

  const monitorNav: NavItem[] = projectBase
    ? [{ to: `${projectBase}/overview`, label: "Overview", icon: LayoutDashboard, end: true }]
    : [];

  const usersNav: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/users`, label: "Users", icon: Users },
        { to: `${projectBase}/journeys`, label: "User Journeys", icon: Route },
        { to: `${projectBase}/sessions`, label: "Sessions", icon: Activity },
      ]
    : [];

  const appNav: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/apis`, label: "API Monitor", icon: Globe },
        { to: `${projectBase}/problems`, label: "Errors", icon: AlertTriangle },
        { to: `${projectBase}/performance`, label: "Performance", icon: Gauge },
      ]
    : [];

  const analyticsNav: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/behavior`, label: "User Behavior", icon: MousePointerClick },
        { to: `${projectBase}/funnels`, label: "Funnels", icon: Filter },
        { to: `${projectBase}/reports`, label: "Reports", icon: BarChart3 },
      ]
    : [];

  const manageNav: NavItem[] = projectBase
    ? [
        { to: `${projectBase}/integration`, label: "Integrations", icon: Plug },
        { to: `${projectBase}/settings`, label: "Settings", icon: Settings },
      ]
    : [];

  const platformNav: NavItem[] = auth.isPlatformAdmin
    ? [
        { to: "/platform", label: "Organizations", icon: Shield, end: true },
        { to: "/platform/packages", label: "SDK packages", icon: Package },
      ]
    : [];

  const crumbs = [
    ...(auth.isPlatformAdmin && location.pathname.startsWith("/platform")
      ? [{ label: "Platform", to: "/platform" }]
      : []),
    ...(currentOrg || auth.org
      ? [{ label: (currentOrg ?? auth.org)!.name, to: home }]
      : []),
    ...(projectName && projectBase ? [{ label: projectName, to: `${projectBase}/overview` }] : []),
  ];

  const sidebar = (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-zinc-200/80 px-3 dark:border-zinc-800">
        <Link
          to={auth.isPlatformAdmin ? "/platform" : home}
          className={clsx(
            "flex min-w-0 flex-1 items-center gap-2.5 font-semibold text-zinc-900 dark:text-zinc-100",
            collapsed && "justify-center"
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
            <Activity className="h-4 w-4" />
          </span>
          {!collapsed && (
            <span className="truncate text-sm tracking-tight">
              Monitor
              <span className="block text-[10px] font-normal uppercase tracking-widest text-zinc-400">
                {auth.isPlatformAdmin
                  ? "Platform"
                  : (currentOrg?.name ?? auth.org?.name ?? "Organization")}
              </span>
            </span>
          )}
        </Link>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="hidden rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 lg:inline-flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto p-3">
        {platformNav.length > 0 && (
          <NavSection title="Platform admin" items={platformNav} collapsed={collapsed} />
        )}
        {orgNav.length > 0 && <NavSection title="Organization" items={orgNav} collapsed={collapsed} />}
        {monitorNav.length > 0 && <NavSection title="Monitor" items={monitorNav} collapsed={collapsed} />}
        {usersNav.length > 0 && <NavSection title="Users" items={usersNav} collapsed={collapsed} />}
        {appNav.length > 0 && <NavSection title="Application" items={appNav} collapsed={collapsed} />}
        {analyticsNav.length > 0 && <NavSection title="Analytics" items={analyticsNav} collapsed={collapsed} />}
        {manageNav.length > 0 && <NavSection title="Management" items={manageNav} collapsed={collapsed} />}
        {!collapsed && orgId && projects.length > 0 && (
          <div className="space-y-1">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">
              Switch project
            </p>
            {projects.slice(0, 8).map((p) => (
              <Link
                key={p.id}
                to={`/orgs/${orgId}/projects/${p.id}/overview`}
                className={clsx(
                  "block truncate rounded-lg px-3 py-1.5 text-xs",
                  p.id === projectId
                    ? "bg-indigo-500/10 font-medium text-indigo-700 dark:text-indigo-300"
                    : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                )}
              >
                {p.name}
              </Link>
            ))}
          </div>
        )}
      </nav>

      <div className="border-t border-zinc-200/80 p-3 dark:border-zinc-800">
        <div
          className={clsx(
            "flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50/80 p-2 dark:border-zinc-800 dark:bg-zinc-900",
            collapsed && "flex-col"
          )}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
            {(auth.email ?? "U").slice(0, 1).toUpperCase()}
          </span>
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-xs text-zinc-600 dark:text-zinc-400">
              {auth.email}
            </span>
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login", { replace: true });
            }}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600 dark:hover:bg-zinc-800"
            title="Log out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-zinc-950/40 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 flex h-screen flex-col border-r border-zinc-200/80 bg-white/95 backdrop-blur transition-transform dark:border-zinc-800 dark:bg-zinc-950/95 lg:sticky lg:translate-x-0",
          collapsed ? "w-[72px]" : "w-64",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-200/80 bg-white/80 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
          <button
            type="button"
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm">
            {crumbs.map((c, i) => (
              <span key={c.to} className="flex min-w-0 items-center gap-1.5">
                {i > 0 && <span className="text-zinc-300 dark:text-zinc-600">/</span>}
                <Link
                  to={c.to}
                  className={clsx(
                    "truncate",
                    i === crumbs.length - 1
                      ? "font-medium text-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  )}
                >
                  {c.label}
                </Link>
              </span>
            ))}
          </nav>
          {projectBase && (
            <div className="hidden sm:block">
              <TimeRangePicker />
            </div>
          )}
          {projectId && (
            <span className="hidden items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300 sm:inline-flex">
              <KeyRound className="h-3 w-3" />
              Project
            </span>
          )}
        </header>
        <main className="flex-1 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { projectId } = useParams();
  if (projectId) {
    return (
      <RangeProvider>
        <AppShellInner>{children}</AppShellInner>
      </RangeProvider>
    );
  }
  return <AppShellInner>{children}</AppShellInner>;
}
