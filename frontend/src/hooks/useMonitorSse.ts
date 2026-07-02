import { useEffect, useRef, useState } from "react";
import { BASE, getToken } from "@/lib/api";

/** Fires when any monitor SSE event is received (for refetch). */
export function useMonitorSse(
  onEvent: () => void,
  enabled: boolean
): { connected: boolean; reconnecting: boolean } {
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const backoff = useRef(2000);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const token = getToken();
      if (!token) return;
      const url = `${window.location.origin}${BASE}/stream?token=${encodeURIComponent(token)}`;
      es = new EventSource(url);
      es.onopen = () => {
        if (cancelled) return;
        setConnected(true);
        setReconnecting(false);
        backoff.current = 2000;
      };
      const names = [
        "service_status",
        "upstream_status",
        "incident_opened",
        "incident_resolved",
        "incident_updated",
      ];
      for (const n of names) {
        es.addEventListener(n, () => {
          handler.current();
        });
      }
      es.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        setReconnecting(true);
        es?.close();
        timer = setTimeout(() => {
          backoff.current = Math.min(backoff.current * 2, 60000);
          connect();
        }, backoff.current);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      es?.close();
      setConnected(false);
    };
  }, [enabled]);

  return { connected, reconnecting };
}
