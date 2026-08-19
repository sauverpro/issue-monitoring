import { clsx } from "clsx";
import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "success" | "danger" | "warning" | "accent";
  icon?: LucideIcon;
}) {
  const tones = {
    default: "border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/50 text-zinc-900 dark:text-white",
    success: "border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300",
    danger: "border-red-500/25 bg-red-500/5 text-red-700 dark:text-red-300",
    warning: "border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-200",
    accent: "border-cyan-500/25 bg-cyan-500/5 text-cyan-700 dark:text-cyan-300",
  };

  return (
    <div
      className={clsx(
        "rounded-xl border p-4 shadow-sm shadow-black/10 ring-1 ring-zinc-950/5 dark:ring-white/[0.02]",
        tones[tone]
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-500">
          {label}
        </dt>
        {Icon && <Icon className="h-4 w-4 shrink-0 opacity-50" />}
      </div>
      <dd className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
        {value}
      </dd>
      {sub && <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}
