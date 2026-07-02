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
    default: "border-zinc-800/80 bg-zinc-900/50 text-white",
    success: "border-emerald-500/25 bg-emerald-500/5 text-emerald-300",
    danger: "border-red-500/25 bg-red-500/5 text-red-300",
    warning: "border-amber-500/25 bg-amber-500/5 text-amber-200",
    accent: "border-cyan-500/25 bg-cyan-500/5 text-cyan-300",
  };

  return (
    <div
      className={clsx(
        "rounded-xl border p-4 shadow-sm shadow-black/10 ring-1 ring-white/[0.02]",
        tones[tone]
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <dt className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </dt>
        {Icon && <Icon className="h-4 w-4 shrink-0 opacity-50" />}
      </div>
      <dd className="mt-2 text-2xl font-bold tabular-nums tracking-tight">
        {value}
      </dd>
      {sub && <p className="mt-1 text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}
