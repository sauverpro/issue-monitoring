import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BarChart3,
  Bug,
  Route,
  ScrollText,
  Users,
  Zap,
} from "lucide-react";

const actions = [
  {
    to: "/monitoring/sessions",
    label: "Investigate sessions",
    icon: Users,
    desc: "User journeys",
  },
  {
    to: "/monitoring/issues",
    label: "Sentry issues",
    icon: Bug,
    desc: "Unresolved errors",
  },
  {
    to: "/endpoints",
    label: "Endpoint metrics",
    icon: Route,
    desc: "Per-URL health",
  },
  {
    to: "/incidents",
    label: "Open incidents",
    icon: AlertTriangle,
    desc: "Active alerts",
  },
  {
    to: "/events?outcome=FAILURE",
    label: "Failure log",
    icon: ScrollText,
    desc: "Recent failures",
  },
  {
    to: "/monitoring/session-analytics",
    label: "Analytics",
    icon: BarChart3,
    desc: "Trends & volume",
  },
] as const;

export function QuickActions() {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-amber-400" />
        <h2 className="text-sm font-medium text-zinc-300">Quick actions</h2>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="group flex items-center gap-3 rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-3 py-2.5 transition hover:border-emerald-500/30 hover:bg-emerald-500/5"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-800/80 text-zinc-400 ring-1 ring-zinc-700/50 transition group-hover:text-emerald-400">
              <a.icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-200 group-hover:text-white">
                {a.label}
              </span>
              <span className="block truncate text-xs text-zinc-500">{a.desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
