import { clsx } from "clsx";
import { useRange } from "@/org/lib/range";

export function Delta({
  value,
  invert,
  className,
}: {
  value: number | null | undefined;
  invert?: boolean;
  className?: string;
}) {
  const { compare } = useRange();
  if (!compare || value == null) {
    return <span className={clsx("text-xs text-zinc-400", className)}>vs prior</span>;
  }
  const good = invert ? value <= 0 : value >= 0;
  const arrow = value > 0 ? "↑" : value < 0 ? "↓" : "→";
  return (
    <span className={clsx("text-xs font-medium", good ? "text-emerald-600" : "text-red-600", className)}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  );
}

export function healthLabel(availability: number, errorRate: number): {
  label: string;
  tone: string;
  dot: string;
} {
  if (availability >= 0.995 && errorRate <= 0.01) {
    return { label: "Healthy", tone: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" };
  }
  if (availability >= 0.97 && errorRate <= 0.05) {
    return { label: "Degraded", tone: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" };
  }
  return { label: "Critical", tone: "text-red-700 dark:text-red-400", dot: "bg-red-500" };
}

export function problemKey(row: { method: string; path: string; statusCode?: number | null }): string {
  return encodeURIComponent(`${row.method}::${row.path}::${row.statusCode ?? ""}`);
}

export function parseProblemKey(raw: string): { method: string; path: string; statusCode: number | null } {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  const first = decoded.indexOf("::");
  const last = decoded.lastIndexOf("::");
  if (first < 0 || last <= first) return { method: "GET", path: decoded || "/", statusCode: null };
  const statusRaw = decoded.slice(last + 2);
  const statusCode = statusRaw === "" ? null : Number(statusRaw);
  return {
    method: decoded.slice(0, first) || "GET",
    path: decoded.slice(first + 2, last) || "/",
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
  };
}
