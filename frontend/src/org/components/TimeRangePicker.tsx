import { RANGE_OPTIONS, useRange, type RangePreset } from "@/org/lib/range";

export function TimeRangePicker() {
  const { range, setPreset, compare, setCompare } = useRange();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        <input
          type="checkbox"
          checked={compare}
          onChange={(e) => setCompare(e.target.checked)}
        />
        Compare: Previous period
      </label>
      <select
        className="input w-40 py-1.5 text-xs"
        value={range.preset}
        onChange={(e) => {
          const next = e.target.value as RangePreset;
          if (next === "custom") {
            setPreset("custom", range.customFrom, range.customTo);
          } else {
            setPreset(next);
          }
        }}
        aria-label="Date range"
      >
        {RANGE_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {range.preset === "custom" && (
        <>
          <input
            type="date"
            className="input w-36 py-1.5 text-xs"
            value={range.customFrom}
            onChange={(e) => setPreset("custom", e.target.value, range.customTo)}
          />
          <input
            type="date"
            className="input w-36 py-1.5 text-xs"
            value={range.customTo}
            onChange={(e) => setPreset("custom", range.customFrom, e.target.value)}
          />
        </>
      )}
    </div>
  );
}
