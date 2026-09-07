import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Delta, healthLabel } from "@/org/lib/metrics";
import type { ProblemSeverity } from "@/org/types";

export function SeverityBadge({ severity }: { severity: ProblemSeverity | string }) {
  const map: Record<string, { icon: string; label: string; className: string }> = {
    critical: { icon: "🔴", label: "CRITICAL", className: "text-red-700 dark:text-red-400" },
    high: { icon: "🟠", label: "HIGH", className: "text-orange-700 dark:text-orange-400" },
    medium: { icon: "🟡", label: "MEDIUM", className: "text-amber-700 dark:text-amber-400" },
    low: { icon: "⚪", label: "LOW", className: "text-zinc-500" },
  };
  const s = map[severity] ?? map.low!;
  return (
    <span className={clsx("text-xs font-semibold uppercase tracking-wide", s.className)}>
      {s.icon} {s.label}
    </span>
  );
}

export function ImpactBar({ score, label }: { score: number; label: string }) {
  const pct = Math.min(100, Math.round(score * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-500">User impact</span>
        <span className="font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
          {label}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={clsx(
            "h-full rounded-full",
            label === "HIGH" ? "bg-red-500" : label === "MEDIUM" ? "bg-amber-500" : "bg-emerald-500"
          )}
          style={{ width: `${Math.max(8, pct)}%` }}
        />
      </div>
    </div>
  );
}

export function SystemHealthStrip({
  availability,
  availabilityDelta,
  avgLatencyMs,
  latencyDelta,
  errorRate,
  errorRateDelta,
}: {
  availability: number;
  availabilityDelta: number | null;
  avgLatencyMs: number;
  latencyDelta: number | null;
  errorRate: number;
  errorRateDelta: number | null;
}) {
  const health = healthLabel(availability, errorRate);
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/60">
      <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
        System health
      </p>
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <span className={clsx("h-2.5 w-2.5 rounded-full", health.dot)} />
          <span className={clsx("text-lg font-semibold", health.tone)}>{health.label}</span>
        </div>
        <MetricPill
          label="Availability"
          value={`${(availability * 100).toFixed(2)}%`}
          delta={availabilityDelta}
        />
        <MetricPill label="API latency" value={`${avgLatencyMs}ms`} delta={latencyDelta} invert />
        <MetricPill
          label="Error rate"
          value={`${(errorRate * 100).toFixed(2)}%`}
          delta={errorRateDelta}
          invert
        />
      </div>
    </div>
  );
}

function MetricPill({
  label,
  value,
  delta,
  invert,
}: {
  label: string;
  value: string;
  delta: number | null;
  invert?: boolean;
}) {
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-zinc-900 dark:text-white">{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
      <Delta value={delta} invert={invert} />
    </div>
  );
}

export function PageToolbar({
  title,
  actions,
}: {
  title?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      {title ? <h2 className="text-sm font-medium text-zinc-600 dark:text-zinc-300">{title}</h2> : <span />}
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}
