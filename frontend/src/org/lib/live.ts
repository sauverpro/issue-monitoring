import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/org/lib/api";
import type { LiveEvent, LiveSnapshot } from "@/org/lib/productOps";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "paused";

export type LiveIncident = { id: string; service?: string; severity?: string; title?: string; status?: string };

type Handlers = {
  onEvents?: (events: LiveEvent[]) => void;
  onTick?: (snapshot: LiveSnapshot) => void;
  onIncident?: (kind: "opened" | "updated" | "resolved", incident: LiveIncident) => void;
  onServiceStatus?: (data: { service: string; status: string }) => void;
};

const STREAM_ORIGIN = (import.meta.env.VITE_STREAM_ORIGIN ?? "").replace(/\/$/, "");

/**
 * Subscribe to a project's live stream. Tickets are short-lived, so instead of
 * EventSource's built-in retry (which would reuse an expired ticket) every
 * reconnect fetches a fresh ticket and resumes from the last event id. The
 * stream is closed while the tab is hidden.
 */
export function useLiveStream(
  projectId: string | undefined,
  opts: { services?: string[]; user?: string | null; enabled?: boolean },
  handlers: Handlers
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const ref = useRef(handlers);
  ref.current = handlers;
  const services = opts.services?.join(",") ?? "";
  const user = opts.user ?? "";
  const enabled = opts.enabled ?? true;

  useEffect(() => {
    if (!projectId || !enabled) {
      setStatus("paused");
      return;
    }
    let es: EventSource | null = null;
    let retry: number | undefined;
    let attempt = 0;
    let lastId: string | null = null;
    let stopped = false;

    const close = () => {
      es?.close();
      es = null;
      window.clearTimeout(retry);
    };

    const scheduleReconnect = () => {
      close();
      if (stopped) return;
      setStatus("reconnecting");
      attempt += 1;
      retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)));
    };

    async function connect() {
      if (stopped || document.visibilityState === "hidden") return;
      try {
        const { ticket } = await apiFetch<{ ticket: string }>(`/console/projects/${projectId}/live/ticket`, { method: "POST" });
        if (stopped) return;
        const q = new URLSearchParams({ ticket });
        if (services) q.set("services", services);
        if (user) q.set("user", user);
        if (lastId) q.set("since", lastId);
        es = new EventSource(`${STREAM_ORIGIN}/console/projects/${projectId}/live/stream?${q}`);
        es.onopen = () => {
          attempt = 0;
          setStatus("live");
        };
        es.onerror = scheduleReconnect;
        es.addEventListener("events", (m) => {
          const msg = m as MessageEvent<string>;
          if (msg.lastEventId) lastId = msg.lastEventId;
          ref.current.onEvents?.(JSON.parse(msg.data) as LiveEvent[]);
        });
        es.addEventListener("tick", (m) => ref.current.onTick?.(JSON.parse((m as MessageEvent<string>).data) as LiveSnapshot));
        for (const [name, kind] of [
          ["incident_opened", "opened"],
          ["incident_updated", "updated"],
          ["incident_resolved", "resolved"],
        ] as const) {
          es.addEventListener(name, (m) => ref.current.onIncident?.(kind, JSON.parse((m as MessageEvent<string>).data) as LiveIncident));
        }
        es.addEventListener("service_status", (m) => ref.current.onServiceStatus?.(JSON.parse((m as MessageEvent<string>).data)));
      } catch {
        scheduleReconnect();
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        close();
        setStatus("paused");
      } else if (!es) {
        setStatus("connecting");
        void connect();
      }
    };

    setStatus("connecting");
    void connect();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      close();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [projectId, services, user, enabled]);

  return status;
}

/** Prepend new events (newest first), de-duplicated by id, capped. */
export function mergeEvents(current: LiveEvent[], incoming: LiveEvent[], cap = 200): LiveEvent[] {
  const seen = new Set(current.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id)).sort((a, b) => b.at.localeCompare(a.at));
  if (!fresh.length) return current;
  return [...fresh, ...current].sort((a, b) => b.at.localeCompare(a.at)).slice(0, cap);
}
