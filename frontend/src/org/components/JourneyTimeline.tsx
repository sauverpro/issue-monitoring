import { clsx } from "clsx";
import type { SessionAction } from "@/org/types";
import {
  classifyKind,
  compactTitle,
  formatClock,
  formatLatency,
  isApiAction,
  pathOnly,
  statusPhrase,
} from "@/org/lib/journey";

const ACTION_LABEL: Record<string, string> = {
  click: "CLICK",
  form_start: "FORM START",
  form_submit: "FORM SUBMIT",
  search: "SEARCH",
  filter: "FILTER",
  modal_open: "MODAL OPEN",
  modal_close: "MODAL CLOSE",
  download: "DOWNLOAD",
  file_upload: "FILE UPLOAD",
  purchase_start: "PURCHASE START",
  purchase_complete: "PURCHASE COMPLETE",
};

type TreeNode =
  | { type: "marker"; time: string; label: string; failed?: boolean }
  | { type: "screen"; label: string }
  | { type: "api"; action: SessionAction; failed: boolean }
  | { type: "click"; action: SessionAction };

function buildTree(actions: SessionAction[]): TreeNode[] {
  const sorted = [...actions].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp.localeCompare(b.timestamp);
    return a.actionIndex - b.actionIndex;
  });
  const nodes: TreeNode[] = [];
  if (sorted.length === 0) return nodes;

  nodes.push({ type: "marker", time: sorted[0]!.timestamp, label: "SESSION START" });
  let lastScreen = "";

  for (const a of sorted) {
    const kind = classifyKind(a);
    if (kind === "screen" || kind === "session") {
      const label = a.screen || pathOnly(a.endpoint) || compactTitle(a);
      if (label && label !== lastScreen) {
        nodes.push({ type: "screen", label });
        lastScreen = label;
      }
    } else if (kind === "action") {
      nodes.push({ type: "click", action: a });
    } else if (kind === "api" || kind === "api_failure" || kind === "error") {
      nodes.push({
        type: "api",
        action: a,
        failed: kind === "api_failure" || kind === "error" || a.status === "failure",
      });
    }
  }

  const last = sorted[sorted.length - 1];
  if (last) {
    nodes.push({ type: "marker", time: last.timestamp, label: "SESSION END" });
  }
  return nodes;
}

export function JourneyTimeline({
  actions,
  onSelect,
}: {
  actions: SessionAction[];
  onSelect?: (action: SessionAction) => void;
}) {
  const tree = buildTree(actions);
  if (tree.length === 0) {
    return <p className="text-sm text-zinc-500">No events in this session.</p>;
  }

  let markerTime = "";
  return (
    <div className="font-mono text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
      {tree.map((node, i) => {
        if (node.type === "marker") {
          markerTime = node.time;
          return (
            <div key={`m-${i}`} className="mb-2 flex gap-3">
              <span className="w-16 shrink-0 tabular-nums text-zinc-400">{formatClock(node.time)}</span>
              <div>
                <p className="font-semibold text-indigo-700 dark:text-indigo-300">● {node.label}</p>
              </div>
            </div>
          );
        }

        if (node.type === "screen") {
          return (
            <div key={`s-${i}`} className="ml-16 mb-1 border-l border-zinc-200 pl-4 dark:border-zinc-700">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{node.label}</p>
            </div>
          );
        }

        if (node.type === "click") {
          const t = (node.action.actionType ?? "").toLowerCase();
          const label = ACTION_LABEL[t] ?? "ACTION";
          return (
            <div key={`c-${i}`} className="ml-16 mb-1 border-l border-zinc-200 pl-4 dark:border-zinc-700">
              <p className="text-zinc-500">{formatClock(node.action.timestamp)}</p>
              <p className="font-medium text-violet-700 dark:text-violet-300">
                ├── {label}
              </p>
              <p className="pl-6 text-zinc-600 dark:text-zinc-400">
                &quot;{node.action.message || node.action.target || "Action"}&quot;
              </p>
            </div>
          );
        }

        const a = node.action;
        const status = statusPhrase(a.httpStatus) || (node.failed ? "Failed" : "OK");
        const latency = formatLatency(a.latencyMs);
        return (
          <div
            key={`a-${a.id}`}
            className={clsx(
              "ml-16 mb-1 border-l pl-4 dark:border-zinc-700",
              node.failed ? "border-red-300" : "border-zinc-200"
            )}
          >
            {!markerTime && (
              <p className="text-zinc-500">{formatClock(a.timestamp)}</p>
            )}
            <button
              type="button"
              className={clsx(
                "text-left",
                isApiAction(a) && "hover:text-indigo-600 dark:hover:text-indigo-400"
              )}
              onClick={() => onSelect?.(a)}
            >
              <p className="font-medium">
                ├── {a.method || "GET"} {pathOnly(a.endpoint)}
              </p>
              <p className={clsx("pl-6", node.failed && "text-red-600 dark:text-red-400")}>
                └── {node.failed ? "🔴 " : ""}
                {status}
                {latency ? `   ${latency}` : ""}
              </p>
            </button>
          </div>
        );
      })}
    </div>
  );
}
