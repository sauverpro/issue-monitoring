import type { SessionAction } from "@/org/types";
import { formatLatency, prettyJson, queryEntries, statusPhrase } from "@/org/lib/journey";

export function ApiDetailDrawer({
  action,
  onClose,
}: {
  action: SessionAction;
  onClose: () => void;
}) {
  const query = queryEntries(action.endpoint);
  const request = prettyJson(action.requestBody);
  const response = prettyJson(action.responseBody);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/50"
        aria-label="Close details"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold tracking-wide">API Request</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-lg leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5 text-sm">
          <section>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              Request
            </p>
            <p className="font-mono text-xs font-semibold">{action.method || "GET"}</p>
            <p className="mt-1 break-all font-mono text-xs text-zinc-600 dark:text-zinc-300">
              {action.endpoint || "—"}
            </p>
            {query.length > 0 && (
              <dl className="mt-3 space-y-1 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900">
                {query.map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="font-medium text-zinc-500">{k}</dt>
                    <dd className="font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {request && (
              <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-zinc-100">
                {request}
              </pre>
            )}
          </section>
          <section>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">
              Response
            </p>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <dt className="text-zinc-500">Status</dt>
                <dd
                  className={
                    action.status === "failure"
                      ? "font-semibold text-red-600 dark:text-red-400"
                      : "font-semibold"
                  }
                >
                  {statusPhrase(action.httpStatus) || action.status || "—"}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-500">Latency</dt>
                <dd className="tabular-nums">{formatLatency(action.latencyMs) || "—"}</dd>
              </div>
            </dl>
            {response && (
              <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-zinc-100">
                {response}
              </pre>
            )}
          </section>
          <section className="space-y-1 text-xs text-zinc-500">
            {action.screen && (
              <p>
                Screen: <span className="font-mono text-zinc-700 dark:text-zinc-300">{action.screen}</span>
              </p>
            )}
            <p>Time: {new Date(action.timestamp).toLocaleString()}</p>
          </section>
        </div>
      </aside>
    </div>
  );
}
