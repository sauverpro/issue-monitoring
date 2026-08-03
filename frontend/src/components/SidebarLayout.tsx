import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import {
  Activity,
  BarChart3,
  Bug,
  ChevronLeft,
  ChevronRight,
  Code2,
  LayoutDashboard,
  ListTree,
  LogOut,
  RefreshCw,
  Route as RouteIcon,
  ScrollText,
  User,
  Users,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useState } from "react";

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
};

const mainNav: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/incidents", label: "Incidents", icon: ListTree },
  { to: "/events", label: "Event log", icon: ScrollText },
  { to: "/endpoints", label: "Endpoints", icon: RouteIcon },
  { to: "/sentry-sync", label: "Sentry Sync", icon: RefreshCw },
];

const monitoringNav: NavItem[] = [
  { to: "/monitoring/issues", label: "Issues", icon: Bug },
  { to: "/monitoring/sessions", label: "Sessions", icon: Users },
  { to: "/monitoring/session-analytics", label: "Analytics", icon: BarChart3 },
];

const developerNav: NavItem[] = [
  { to: "/api-docs", label: "Analyst APIs & Docs", icon: Code2 },
];

function NavSection({
  title,
  items,
  collapsed,
}: {
  title: string;
  items: NavItem[];
  collapsed: boolean;
}) {
  return (
    <div className="space-y-1">
      {!collapsed && (
        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
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
                ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
              collapsed && "justify-center px-2"
            )
          }
        >
          <item.icon className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{item.label}</span>}
        </NavLink>
      ))}
    </div>
  );
}

export function SidebarLayout({ children }: { children: ReactNode }) {
  const { auth, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <aside
        className={clsx(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-zinc-800/80 bg-zinc-950/95 backdrop-blur transition-[width]",
          collapsed ? "w-[68px]" : "w-60"
        )}
      >
        <div className="flex h-14 items-center gap-2 border-b border-zinc-800/80 px-3">
          <Link
            to="/"
            className={clsx(
              "flex min-w-0 flex-1 items-center gap-2 font-semibold text-zinc-100",
              collapsed && "justify-center"
            )}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/30">
              <Activity className="h-4 w-4 text-emerald-400" />
            </span>
            {!collapsed && (
              <span className="truncate text-sm tracking-tight">Koralink</span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto p-3">
          <NavSection title="Main" items={mainNav} collapsed={collapsed} />
          <NavSection title="Monitoring" items={monitoringNav} collapsed={collapsed} />
          <NavSection title="Developer & PowerBI" items={developerNav} collapsed={collapsed} />
        </nav>

        <div className="border-t border-zinc-800/80 p-3">
          <div
            className={clsx(
              "flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-2",
              collapsed && "flex-col"
            )}
          >
            <User className="h-4 w-4 shrink-0 text-zinc-500" />
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                {auth.email ?? "User"}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                logout();
                navigate("/login", { replace: true });
              }}
              className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
