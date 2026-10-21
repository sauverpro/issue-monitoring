/**
 * Project-scoped live stream (SSE). Each connection belongs to one project and
 * may narrow to some services or a single agent. Ingested events are batched
 * per connection and flushed once a second; status/incident events go out
 * immediately. A short replay buffer lets reconnecting clients resume from
 * Last-Event-ID without gaps.
 */
import type { Response } from "express";
import { recordLiveEvent, statsFor, type LiveEvent } from "../services/liveStats.js";

type LiveClient = {
  res: Response;
  projectId: string;
  /** Services the project may see (its upstream slugs). */
  allowed: Set<string>;
  /** Optional narrowing chosen by the client. */
  services: Set<string> | null;
  userKey: string | null;
  queue: LiveEvent[];
};

const MAX_QUEUE = 300;
const REPLAY_SIZE = 500;
const FLUSH_MS = 1000;
const TICK_MS = 5000;
const HEARTBEAT_MS = 20_000;

const clients = new Set<LiveClient>();
const replay = new Map<string, { seq: number; ev: LiveEvent }[]>();
let seq = Date.now();

function matches(c: LiveClient, ev: LiveEvent): boolean {
  if (c.userKey && ev.userKey !== c.userKey) return false;
  if (ev.kind === "api" && ev.service) {
    if (c.services && !c.services.has(ev.service)) return false;
  } else if (c.services && !c.userKey) {
    // A service-filtered feed only shows API traffic.
    return false;
  }
  return true;
}

function write(c: LiveClient, event: string, data: unknown, id?: number): boolean {
  try {
    if (id != null) c.res.write(`id: ${id}\n`);
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    clients.delete(c);
    return false;
  }
}

export function addLiveClient(opts: {
  res: Response;
  projectId: string;
  allowedServices: string[];
  services?: string[] | null;
  userKey?: string | null;
  lastEventId?: number | null;
}): () => void {
  const c: LiveClient = {
    res: opts.res,
    projectId: opts.projectId,
    allowed: new Set(opts.allowedServices),
    services: opts.services?.length ? new Set(opts.services) : null,
    userKey: opts.userKey || null,
    queue: [],
  };
  clients.add(c);
  if (opts.lastEventId != null) {
    const missed = (replay.get(opts.projectId) ?? []).filter((r) => r.seq > opts.lastEventId! && matches(c, r.ev));
    if (missed.length) write(c, "events", missed.map((m) => m.ev), missed[missed.length - 1]!.seq);
  }
  ensureTimers();
  return () => clients.delete(c);
}

/** Record into live stats, the replay buffer, and every matching connection's queue. */
export function publishLiveEvent(projectId: string, ev: LiveEvent): void {
  recordLiveEvent(projectId, ev);
  const s = ++seq;
  let buf = replay.get(projectId);
  if (!buf) replay.set(projectId, (buf = []));
  buf.push({ seq: s, ev });
  if (buf.length > REPLAY_SIZE) buf.splice(0, buf.length - REPLAY_SIZE);
  for (const c of clients) {
    if (c.projectId !== projectId || !matches(c, ev)) continue;
    c.queue.push(ev);
    // Slow consumer: drop the oldest feed rows, never status events.
    if (c.queue.length > MAX_QUEUE) c.queue.splice(0, c.queue.length - MAX_QUEUE);
  }
}

/**
 * Relay a global ops event (incident / service status) to project streams that
 * include the service. Events without a service go to everyone.
 */
export function relayGlobalEvent(event: string, data: unknown): void {
  const service = (data as { service?: unknown } | null)?.service;
  for (const c of clients) {
    if (typeof service === "string") {
      if (!c.allowed.has(service)) continue;
      if (c.services && !c.services.has(service)) continue;
    }
    write(c, event, data);
  }
}

export function liveClientCount(projectId?: string): number {
  if (!projectId) return clients.size;
  let n = 0;
  for (const c of clients) if (c.projectId === projectId) n += 1;
  return n;
}

let timers: NodeJS.Timeout[] = [];

function ensureTimers(): void {
  if (timers.length) return;
  timers = [
    setInterval(() => {
      for (const c of clients) {
        if (!c.queue.length) continue;
        const batch = c.queue.splice(0, c.queue.length);
        write(c, "events", batch, seq);
      }
    }, FLUSH_MS),
    setInterval(() => {
      const now = Date.now();
      const byProject = new Map<string, LiveClient[]>();
      for (const c of clients) byProject.set(c.projectId, [...(byProject.get(c.projectId) ?? []), c]);
      for (const [projectId, list] of byProject) {
        const snap = statsFor(projectId).snapshot(now, [...list[0]!.allowed]);
        for (const c of list) {
          write(c, "tick", c.services ? { ...snap, services: snap.services.filter((s) => c.services!.has(s.service)) } : snap);
        }
      }
    }, TICK_MS),
    setInterval(() => {
      for (const c of clients) {
        try {
          c.res.write(": ping\n\n");
        } catch {
          clients.delete(c);
        }
      }
    }, HEARTBEAT_MS),
  ];
  for (const t of timers) t.unref();
}
