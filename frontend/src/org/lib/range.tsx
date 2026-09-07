import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type RangePreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "this_month"
  | "last_month"
  | "custom";

export const RANGE_OPTIONS: { id: RangePreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "custom", label: "Custom range" },
];

const STORAGE_KEY = "monitor_org_range";

export type ResolvedRange = {
  preset: RangePreset;
  from: Date;
  to: Date;
  label: string;
  days: number;
  query: URLSearchParams;
  customFrom: string;
  customTo: string;
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function resolvePreset(
  preset: RangePreset,
  customFrom?: string,
  customTo?: string
): { from: Date; to: Date; label: string } {
  const now = new Date();
  if (preset === "today") {
    return { from: startOfDay(now), to: endOfDay(now), label: "Today" };
  }
  if (preset === "yesterday") {
    const y = new Date(now);
    y.setDate(y.getDate() - 1);
    return { from: startOfDay(y), to: endOfDay(y), label: "Yesterday" };
  }
  if (preset === "7d") {
    const from = startOfDay(new Date(now.getTime() - 6 * 86400000));
    return { from, to: now, label: "Last 7 days" };
  }
  if (preset === "30d") {
    const from = startOfDay(new Date(now.getTime() - 29 * 86400000));
    return { from, to: now, label: "Last 30 days" };
  }
  if (preset === "this_month") {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now, label: "This month" };
  }
  if (preset === "last_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
    return { from, to, label: "Last month" };
  }
  const from = customFrom ? new Date(`${customFrom}T00:00:00`) : startOfDay(new Date(now.getTime() - 6 * 86400000));
  const to = customTo ? new Date(`${customTo}T23:59:59.999`) : now;
  return {
    from,
    to,
    label: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
  };
}

type Stored = { preset: RangePreset; from?: string; to?: string; compare?: boolean };

function loadStored(): Stored {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { preset: "7d", compare: true };
    const parsed = JSON.parse(raw) as Stored;
    if (!RANGE_OPTIONS.some((o) => o.id === parsed.preset)) return { preset: "7d", compare: true };
    return { compare: true, ...parsed };
  } catch {
    return { preset: "7d", compare: true };
  }
}

const RangeContext = createContext<{
  range: ResolvedRange;
  setPreset: (preset: RangePreset, customFrom?: string, customTo?: string) => void;
  compare: boolean;
  setCompare: (value: boolean) => void;
} | null>(null);

export function RangeProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<Stored>(loadStored);
  const resolved = useMemo(
    () => resolvePreset(stored.preset, stored.from, stored.to),
    [stored.preset, stored.from, stored.to]
  );
  const days = Math.max(1, Math.ceil((resolved.to.getTime() - resolved.from.getTime()) / 86400000));
  const query = useMemo(() => {
    const q = new URLSearchParams();
    q.set("from", resolved.from.toISOString());
    q.set("to", resolved.to.toISOString());
    q.set("days", String(days));
    return q;
  }, [resolved.from, resolved.to, days]);

  const setPreset = useCallback((next: RangePreset, from?: string, to?: string) => {
    setStored((prev) => {
      const current = resolvePreset(next === "custom" ? "custom" : next, from, to);
      const value: Stored =
        next === "custom"
          ? { preset: "custom", from: from ?? ymd(current.from), to: to ?? ymd(current.to), compare: prev.compare }
          : { preset: next, compare: prev.compare };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return value;
    });
  }, []);

  const setCompare = useCallback((next: boolean) => {
    setStored((prev) => {
      const value: Stored = { ...prev, compare: next };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return value;
    });
  }, []);

  const value = useMemo(
    () => ({
      range: {
        preset: stored.preset,
        from: resolved.from,
        to: resolved.to,
        label: resolved.label,
        days,
        query,
        customFrom: stored.from ?? ymd(resolved.from),
        customTo: stored.to ?? ymd(resolved.to),
      },
      setPreset,
      compare: stored.compare ?? true,
      setCompare,
    }),
    [
      stored.preset,
      stored.from,
      stored.to,
      stored.compare,
      resolved.from,
      resolved.to,
      resolved.label,
      days,
      query,
      setPreset,
      setCompare,
    ]
  );

  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

export function useRange() {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error("useRange outside provider");
  return ctx;
}
