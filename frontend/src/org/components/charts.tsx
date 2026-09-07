import { clsx } from "clsx";

export function Sparkline({
  values,
  className,
  color = "rgb(99 102 241)",
}: {
  values: number[];
  className?: string;
  color?: string;
}) {
  if (values.length < 2) return <div className={clsx("h-8", className)} />;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const w = 120;
  const h = 32;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={clsx("h-8 w-full", className)} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
    </svg>
  );
}

export function LineChart({
  series,
  labels,
  height = 180,
}: {
  series: { name: string; color: string; values: number[] }[];
  labels: string[];
  height?: number;
}) {
  const w = 640;
  const h = height;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = Math.max(1, (series[0]?.values.length ?? 1) - 1);
  function pts(values: number[]) {
    return values
      .map((v, i) => {
        const x = pad.l + (i / n) * innerW;
        const y = pad.t + innerH - (v / max) * innerH;
        return `${x},${y}`;
      })
      .join(" ");
  }
  const tickEvery = Math.max(1, Math.ceil(labels.length / 7));
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[180px] w-full">
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2.5" points={pts(s.values)} />
        ))}
        {labels.map((label, i) =>
          i % tickEvery === 0 ? (
            <text
              key={label + i}
              x={pad.l + (i / n) * innerW}
              y={h - 6}
              textAnchor="middle"
              className="fill-zinc-400"
              fontSize="10"
            >
              {label}
            </text>
          ) : null
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 px-2 text-xs text-zinc-500">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
    </div>
  );
}

export function BarChart({
  values,
  labels,
  color = "rgb(139 92 246)",
}: {
  values: number[];
  labels: string[];
  color?: string;
}) {
  const max = Math.max(1, ...values);
  return (
    <div>
      <div className="flex h-40 items-end gap-1.5">
        {values.map((v, i) => (
          <div key={labels[i] ?? i} className="flex flex-1 flex-col items-center justify-end" title={`${labels[i]} · ${v}`}>
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(4, (v / max) * 100)}%`, background: color }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1.5 text-[10px] text-zinc-400">
        {labels.map((l, i) => (
          <span key={l + i} className="min-w-0 flex-1 truncate text-center">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

export function HorizontalBars({
  items,
  color = "rgb(99 102 241)",
}: {
  items: { label: string; value: number; hint?: string }[];
  color?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs">
            <span className="truncate font-mono">{i.label}</span>
            <span className="shrink-0 tabular-nums text-zinc-500">{i.hint ?? i.value.toLocaleString()}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div className="h-full rounded-full" style={{ width: `${(i.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

const DONUT_COLORS = ["#3b82f6", "#8b5cf6", "#22c55e", "#f59e0b", "#64748b", "#ef4444", "#06b6d4"];

export function DonutChart({
  slices,
  center,
}: {
  slices: { label: string; value: number; color?: string }[];
  center: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = 36;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0">
        {slices.map((s, i) => {
          const len = (s.value / total) * c;
          const dash = `${len} ${c - len}`;
          const el = (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={s.color ?? DONUT_COLORS[i % DONUT_COLORS.length]}
              strokeWidth="12"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
            />
          );
          offset += len;
          return el;
        })}
        <text x="50" y="48" textAnchor="middle" className="fill-zinc-500" fontSize="7">
          Total
        </text>
        <text x="50" y="60" textAnchor="middle" className="fill-zinc-900 dark:fill-white" fontSize="10" fontWeight="600">
          {center}
        </text>
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.color ?? DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="tabular-nums text-zinc-500">{((s.value / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
