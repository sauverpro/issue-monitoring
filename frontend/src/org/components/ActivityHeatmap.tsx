import { clsx } from "clsx";
import type { JourneyDay } from "@/org/types";
import { dayLabel } from "@/org/lib/journey";

const LEVEL = ["░", "▒", "▓", "█"] as const;

function level(actions: number, max: number): (typeof LEVEL)[number] {
  if (actions <= 0) return "░";
  const ratio = actions / Math.max(1, max);
  if (ratio >= 0.75) return "█";
  if (ratio >= 0.5) return "▓";
  if (ratio >= 0.25) return "▒";
  return "░";
}

export function ActivityHeatmap({
  month,
  days,
  selected,
  onSelect,
  onMonthChange,
}: {
  month: Date;
  days: JourneyDay[];
  selected: string;
  onSelect: (date: string) => void;
  onMonthChange: (next: Date) => void;
}) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0);
  const startPad = (first.getDay() + 6) % 7;
  const map = new Map(days.map((d) => [d.date, d]));
  const maxActions = Math.max(1, ...days.map((d) => d.actions));

  const cells: ({ empty: true } | { empty: false; date: string; day: number; data: JourneyDay })[] = [];
  for (let i = 0; i < startPad; i++) cells.push({ empty: true });
  for (let d = 1; d <= last.getDate(); d++) {
    const date = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({
      empty: false,
      date,
      day: d,
      data: map.get(date) ?? { date, sessions: 0, actions: 0, errors: 0, durationMs: 0 },
    });
  }

  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => onMonthChange(new Date(y, m - 1, 1))}>
          ←
        </button>
        <p className="text-sm font-semibold tracking-wide text-zinc-700 dark:text-zinc-200">{monthLabel}</p>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" onClick={() => onMonthChange(new Date(y, m + 1, 1))}>
          →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase text-zinc-400">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((cell, i) =>
          cell.empty ? (
            <span key={`e-${i}`} />
          ) : (
            <button
              key={cell.date}
              type="button"
              onClick={() => onSelect(cell.date)}
              className={clsx(
                "min-h-[4.5rem] rounded-lg border p-1 text-left transition",
                selected === cell.date
                  ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500/30 dark:bg-indigo-500/15"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900/60"
              )}
            >
              <span className="text-xs font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
                {cell.day}
              </span>
              {cell.data.actions > 0 && (
                <>
                  <p className="mt-1 text-lg leading-none">{level(cell.data.actions, maxActions)}</p>
                  <p className="mt-0.5 text-[9px] text-zinc-500">{cell.data.actions} actions</p>
                </>
              )}
              {cell.data.errors > 0 && <p className="text-[9px] text-red-600">🔴</p>}
              {selected === cell.date && cell.data.actions > 0 && (
                <p className="mt-0.5 text-[9px] font-medium text-indigo-600 dark:text-indigo-400">
                  {dayLabel(cell.date)}
                </p>
              )}
            </button>
          )
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-zinc-500">
        <span>Legend:</span>
        <span>░ Low</span>
        <span>▒ Medium</span>
        <span>▓ High</span>
        <span>█ Very high</span>
        <span>🔴 Errors</span>
      </div>
    </div>
  );
}
