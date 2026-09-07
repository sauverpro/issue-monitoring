import type { FormEvent } from "react";

export type JourneyFilters = {
  sessionId: string;
  screen: string;
  kind: string;
  status: string;
  method: string;
  statusClass: string;
  minLatency: string;
};

export const EMPTY_FILTERS: JourneyFilters = {
  sessionId: "",
  screen: "",
  kind: "all",
  status: "all",
  method: "all",
  statusClass: "all",
  minLatency: "",
};

export function FilterBar({
  value,
  onChange,
  onApply,
  sessions,
  hideSession,
}: {
  value: JourneyFilters;
  onChange: (next: JourneyFilters) => void;
  onApply: () => void;
  sessions?: { sessionId: string; startedAt: string }[];
  hideSession?: boolean;
}) {
  function set<K extends keyof JourneyFilters>(key: K, v: JourneyFilters[K]) {
    onChange({ ...value, [key]: v });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    onApply();
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900/60">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400">Filters</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {!hideSession && (
        <label className="text-xs font-medium text-zinc-500">
          Session
          <select
            className="input mt-1"
            value={value.sessionId}
            onChange={(e) => set("sessionId", e.target.value)}
          >
            <option value="">All sessions</option>
            {(sessions ?? []).map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.sessionId.slice(0, 10)}… · {new Date(s.startedAt).toLocaleTimeString()}
              </option>
            ))}
          </select>
        </label>
        )}
        <label className="text-xs font-medium text-zinc-500">
          Screen
          <input
            className="input mt-1"
            placeholder="All screens"
            value={value.screen}
            onChange={(e) => set("screen", e.target.value)}
          />
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Event
          <select className="input mt-1" value={value.kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="all">All events</option>
            <option value="screen">Screen</option>
            <option value="api">API</option>
            <option value="api_failure">API failure</option>
            <option value="action">Action</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Status
          <select className="input mt-1" value={value.status} onChange={(e) => set("status", e.target.value)}>
            <option value="all">All</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-500">
          HTTP method
          <select className="input mt-1" value={value.method} onChange={(e) => set("method", e.target.value)}>
            <option value="all">All</option>
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Status code
          <select
            className="input mt-1"
            value={value.statusClass}
            onChange={(e) => set("statusClass", e.target.value)}
          >
            <option value="all">All</option>
            <option value="2xx">2xx</option>
            <option value="3xx">3xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-500">
          Latency
          <select
            className="input mt-1"
            value={value.minLatency}
            onChange={(e) => set("minLatency", e.target.value)}
          >
            <option value="">Any</option>
            <option value="500">&gt; 500ms</option>
            <option value="1000">&gt; 1s</option>
            <option value="2000">&gt; 2s</option>
          </select>
        </label>
      </div>
      <button className="btn-primary" type="submit">
        Apply filters
      </button>
    </form>
  );
}
