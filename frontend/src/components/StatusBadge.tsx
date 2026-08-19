import { Activity, AlertTriangle, XCircle } from "lucide-react";
import { clsx } from "clsx";

export type ServiceStatus = "operational" | "degraded" | "down";

const config: Record<
  ServiceStatus,
  { label: string; className: string; Icon: typeof Activity }
> = {
  operational: {
    label: "Operational",
    className:
      "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30",
    Icon: Activity,
  },
  degraded: {
    label: "Degraded",
    className: "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30",
    Icon: AlertTriangle,
  },
  down: {
    label: "Down",
    className: "bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/30",
    Icon: XCircle,
  },
};

export function StatusBadge({ status }: { status: ServiceStatus }) {
  const c = config[status];
  const Icon = c.Icon;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        c.className
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {c.label}
    </span>
  );
}
