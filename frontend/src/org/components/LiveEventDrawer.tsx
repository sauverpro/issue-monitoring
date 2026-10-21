import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import {
  ArrowRight,
  Globe,
  LogIn,
  LogOut,
  MousePointerClick,
  Navigation,
  Power,
  Search,
  ShoppingCart,
  SquarePen,
  X,
} from "lucide-react";
import { apiFetch } from "@/org/lib/api";
import { ResultClassBadge } from "@/org/components/monitor";
import { Badge } from "@/org/components/ui";
import {
  agentLabel,
  describeLive,
  fmtClock,
  isFailure,
  type LiveEventDetail,
} from "@/org/lib/productOps";

/** Icon + accent per event kind, shared by feeds and timelines. */
export function kindVisual(kind: string): { icon: typeof Globe; tone: string; label: string } {
  switch (kind) {
    case "api":
      return { icon: Globe, tone: "text-indigo-500", label: "API call" };
    case "navigation":
    case "screen_view":
      return { icon: Navigation, tone: "text-sky-500", label: "Screen" };
    case "click":
      return { icon: MousePointerClick, tone: "text-violet-500", label: "Tap" };
    case "form_start":
    case "form_submit":
      return { icon: SquarePen, tone: "text-teal-500", label: "Form" };
    case "search":
    case "filter":
      return { icon: Search, tone: "text-teal-500", label: kind === "search" ? "Search" : "Filter" };
    case "purchase_start":
    case "purchase_complete":
      return { icon: ShoppingCart, tone: "text-emerald-500", label: "Purchase" };
    case "auth":
      return { icon: LogIn, tone: "text-amber-500", label: "Auth" };
    case "logout":
      return { icon: LogOut, tone: "text-amber-500", label: "Logout" };
    default:
      return { icon: Power, tone: "text-zinc-400", label: kind === "lifecycle" ? "App" : kind };
  }
}

/** Plain-language meaning of an HTTP status for support staff. */
export function statusHint(status: number | null | undefined): string | null {
  if (status == null || status === 0) return "No response — network dropped or timed out.";
  if (status === 401) return "Login expired — the token was rejected.";
  if (status === 403) return "Not allowed for this account.";
  if (status === 404) return "Not found — wrong or missing id/route.";
  if (status === 400 || status === 422) return "Invalid request — the app sent data the server rejected.";
  if (status === 429) return "Rate limited by the provider.";
  if (status >= 500) return "Server/provider error.";
  return null;
}

function prettyBody(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</p>
      {children}
    </div>
  );
}

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
      {rows
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-zinc-400">{k}</dt>
            <dd className="min-w-0 break-words text-zinc-800 dark:text-zinc-200">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

function Code({ text }: { text: string }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] leading-relaxed text-zinc-100">{text}</pre>
  );
}

/** The model of the event itself: what an API call / screen / tap / form … looked like. */
function EventModel({ d }: { d: LiveEventDetail }) {
  const e = d.event;
  const p = (d.payload ?? {}) as Record<string, unknown>;
  const val = (k: string) => (p[k] == null || p[k] === "" ? null : String(p[k]));

  if (e.kind === "api") {
    const req = prettyBody(d.api?.requestBody);
    const res = prettyBody(d.api?.responseBody);
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs font-semibold dark:bg-zinc-800">{e.method}</span>
          <span className="min-w-0 break-all font-mono text-xs">{e.path}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ResultClassBadge resultClass={e.result} />
          <Badge tone={isFailure(e) ? "red" : "green"}>HTTP {e.status || "—"}</Badge>
          <Badge>{e.latencyMs != null ? `${e.latencyMs.toLocaleString()} ms` : "— ms"}</Badge>
          {e.service && <Badge tone="indigo">{e.service}</Badge>}
        </div>
        {isFailure(e) && statusHint(e.status) && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">{statusHint(e.status)}</p>
        )}
        <KV
          rows={[
            ["URL", d.api?.url ? <span className="font-mono">{d.api.url}</span> : null],
            ["On screen", e.screen ?? null],
            ["Failure reason", d.api?.failureReason ?? null],
            ["Error code", d.api?.errorCode ?? null],
          ]}
        />
        {req && (
          <Section title="Request body">
            <Code text={req} />
          </Section>
        )}
        <Section title="Response body">{res ? <Code text={res} /> : <p className="text-xs text-zinc-500">No body captured.</p>}</Section>
      </div>
    );
  }

  if (e.kind === "navigation" || e.kind === "screen_view") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-lg bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-800">{e.fromScreen ?? "start"}</span>
        <ArrowRight className="h-4 w-4 text-zinc-400" />
        <span className="rounded-lg bg-sky-50 px-2 py-1 font-mono text-xs text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">{e.screen ?? "?"}</span>
      </div>
    );
  }

  const specific: [string, ReactNode][] =
    e.kind === "click"
      ? [["Tapped", val("label")], ["Target", val("target")]]
      : e.kind === "form_start" || e.kind === "form_submit"
        ? [["Form", val("form")], ["Result", p.success == null ? null : p.success ? "Submitted successfully" : "Submit failed"]]
        : e.kind === "search"
          ? [["Query", val("query")], ["Results", val("results_count")]]
          : e.kind === "filter"
            ? [["Filter", val("filter")], ["Value", val("value")]]
            : e.kind.startsWith("purchase")
              ? [["Item", val("item")], ["Amount", val("amount") ? `${val("amount")} ${val("currency") ?? ""}` : null], ["Order", val("order_id")]]
              : e.kind === "modal_open" || e.kind === "modal_close"
                ? [["Dialog", val("modal")]]
                : e.kind === "download" || e.kind === "file_upload"
                  ? [["File", val("file")], ["Size", val("size_bytes") ? `${val("size_bytes")} bytes` : null]]
                  : [];
  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-800 dark:text-zinc-200">{e.message || kindVisual(e.kind).label}</p>
      <KV rows={[...specific, ["On screen", e.screen ?? null]]} />
    </div>
  );
}

export function LiveEventDrawer({
  projectId,
  eventId,
  orgId,
  onClose,
  onSelect,
}: {
  projectId: string;
  orgId: string;
  eventId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [d, setD] = useState<LiveEventDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setD(null);
    setError(null);
    apiFetch<LiveEventDetail>(`/console/projects/${projectId}/live/events/${encodeURIComponent(eventId)}`)
      .then(setD)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load event"));
  }, [projectId, eventId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const v = d ? kindVisual(d.event.kind) : null;
  const base = `/orgs/${orgId}/projects/${projectId}`;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-label="Event detail" className="flex h-full w-full max-w-xl flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          {v && <v.icon className={clsx("h-4 w-4", v.tone)} />}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{d ? `${v!.label} · ${describeLive(d.event)}` : "Event"}</p>
          <button type="button" onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          {!d ? (
            <p className="text-sm text-zinc-500">{error ?? "Loading…"}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                <span>{new Date(d.event.at).toLocaleString()}</span>
                <Link className="font-medium text-indigo-600 hover:underline dark:text-indigo-400" to={`${base}/live?agent=${encodeURIComponent(d.event.userKey)}`} onClick={onClose}>
                  {agentLabel(d.event)}
                </Link>
                {d.session?.platform && <span>{d.session.platform}{d.session.os ? ` · ${d.session.os}` : ""}</span>}
                {d.session?.appVersion && <span>v{d.session.appVersion}</span>}
                {d.session?.network && <span>{d.session.network}</span>}
              </div>

              <EventModel d={d} />

              {d.screenPath.length > 0 && (
                <Section title="Journey up to this moment">
                  <div className="flex flex-wrap items-center gap-1">
                    {d.screenPath.map((s, i) => (
                      <span key={`${s.screen}-${i}`} className="flex items-center gap-1">
                        {i > 0 && <ArrowRight className="h-3 w-3 text-zinc-300" />}
                        <span
                          title={fmtClock(s.at)}
                          className={clsx(
                            "rounded-md px-1.5 py-0.5 font-mono text-[11px]",
                            i === d.screenPath.length - 1 ? "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                          )}
                        >
                          {s.screen}
                        </span>
                      </span>
                    ))}
                  </div>
                </Section>
              )}

              <Section title="What happened around it">
                <ol className="relative space-y-0.5 border-l border-zinc-200 pl-4 dark:border-zinc-800">
                  {d.around.map((e) => {
                    const ev = kindVisual(e.kind);
                    const current = e.id === d.event.id;
                    return (
                      <li key={e.id}>
                        <button
                          type="button"
                          onClick={() => !current && onSelect(e.id)}
                          className={clsx(
                            "relative flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs",
                            current ? "bg-indigo-50 font-medium dark:bg-indigo-500/15" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                          )}
                        >
                          <span className={clsx("absolute -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-white dark:border-zinc-900", isFailure(e) ? "bg-red-500" : current ? "bg-indigo-500" : "bg-zinc-300")} />
                          <ev.icon className={clsx("h-3.5 w-3.5 shrink-0", ev.tone)} />
                          <span className="w-16 shrink-0 tabular-nums text-zinc-400">{fmtClock(e.at)}</span>
                          <span className="min-w-0 flex-1 truncate">{describeLive(e)}</span>
                          {e.kind === "api" && <span className={clsx("tabular-nums", isFailure(e) ? "text-red-600" : "text-zinc-400")}>{e.status || "net"}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </Section>

              {d.payload && d.event.kind !== "api" && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-zinc-500">Raw event</summary>
                  <div className="mt-2">
                    <Code text={JSON.stringify(d.payload, null, 2)} />
                  </div>
                </details>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
