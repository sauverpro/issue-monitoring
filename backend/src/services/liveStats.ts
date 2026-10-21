/**
 * In-memory rolling statistics for the live dashboard. Every ingested event is
 * recorded into per-second buckets per project + service (15 minutes kept), and
 * per-agent presence is tracked so "who is online and what are they doing" is
 * answered without querying Postgres on every tick.
 */
import { errorRateToDisplayStatus } from "./slidingWindow.js";
import type { HttpResultClass } from "./httpResultClass.js";

export type LiveEvent = {
  /** Stable event id (same as api_events / session_actions sentry_event_id). */
  id: string;
  kind: string;
  at: string;
  sessionId: string;
  userKey: string;
  email: string | null;
  userId: string | null;
  service?: string;
  method?: string;
  path?: string;
  status?: number | null;
  latencyMs?: number | null;
  result?: HttpResultClass;
  screen?: string | null;
  fromScreen?: string | null;
  message?: string | null;
  platform?: string | null;
  appVersion?: string | null;
};

type Bucket = { calls: number; errors: number; latSum: number; lat: number[] };

export type AgentPresence = {
  userKey: string;
  email: string | null;
  userId: string | null;
  sessionId: string;
  lastAt: number;
  firstAt: number;
  lastScreen: string | null;
  lastAction: string;
  events: number;
  apiCalls: number;
  errors: number;
  platform: string | null;
  appVersion: string | null;
};

export type ServiceLive = {
  service: string;
  status: "operational" | "degraded" | "down" | "idle";
  calls1m: number;
  errors1m: number;
  errorRate1m: number | null;
  errorRate5m: number | null;
  calls5m: number;
  p95Ms1m: number | null;
  avgMs1m: number | null;
  agents1m: number;
  /** Last 15 minutes, one point per minute, oldest first. */
  series: { calls: number; errors: number }[];
};

export type LiveSnapshot = {
  at: string;
  agentsOnline: number;
  callsPerMin: number;
  errorsPerMin: number;
  services: ServiceLive[];
};

const KEEP_SECONDS = 15 * 60;
const AGENT_ONLINE_MS = 5 * 60_000;
const AGENT_KEEP_MS = 60 * 60_000;
const LAT_SAMPLES_PER_BUCKET = 40;

const isError = (r?: HttpResultClass) => r != null && r !== "success";

export function describeAction(ev: LiveEvent): string {
  if (ev.kind === "api") return `${ev.method ?? "GET"} ${ev.path ?? "/"} → ${ev.status || "network"}`;
  if (ev.message) return ev.message;
  if (ev.screen) return `${ev.kind} ${ev.screen}`;
  return ev.kind;
}

function p95(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!;
}

class ProjectStats {
  /** service → second → bucket */
  readonly services = new Map<string, Map<number, Bucket>>();
  /** service → second → user keys (for agents per service) */
  readonly serviceUsers = new Map<string, Map<number, Set<string>>>();
  readonly agents = new Map<string, AgentPresence>();
  readonly seen = new Set<string>();
  seededAt = 0;

  record(ev: LiveEvent): void {
    // Seed + live ingest can overlap; count each event once.
    if (this.seen.has(ev.id)) return;
    this.seen.add(ev.id);
    if (this.seen.size > 20_000) this.seen.clear();

    const ts = Date.parse(ev.at);
    const t = Number.isFinite(ts) ? ts : Date.now();
    const sec = Math.floor(t / 1000);

    if (ev.kind === "api" && ev.service) {
      let buckets = this.services.get(ev.service);
      if (!buckets) this.services.set(ev.service, (buckets = new Map()));
      let b = buckets.get(sec);
      if (!b) buckets.set(sec, (b = { calls: 0, errors: 0, latSum: 0, lat: [] }));
      b.calls += 1;
      if (isError(ev.result)) b.errors += 1;
      if (ev.latencyMs != null && ev.latencyMs >= 0) {
        b.latSum += ev.latencyMs;
        if (b.lat.length < LAT_SAMPLES_PER_BUCKET) b.lat.push(ev.latencyMs);
      }
      let users = this.serviceUsers.get(ev.service);
      if (!users) this.serviceUsers.set(ev.service, (users = new Map()));
      let set = users.get(sec);
      if (!set) users.set(sec, (set = new Set()));
      set.add(ev.userKey);
    }

    const a = this.agents.get(ev.userKey);
    if (!a) {
      this.agents.set(ev.userKey, {
        userKey: ev.userKey,
        email: ev.email,
        userId: ev.userId,
        sessionId: ev.sessionId,
        firstAt: t,
        lastAt: t,
        lastScreen: ev.kind === "api" ? null : (ev.screen ?? null),
        lastAction: describeAction(ev),
        events: 1,
        apiCalls: ev.kind === "api" ? 1 : 0,
        errors: ev.kind === "api" && isError(ev.result) ? 1 : 0,
        platform: ev.platform ?? null,
        appVersion: ev.appVersion ?? null,
      });
    } else {
      a.events += 1;
      if (ev.kind === "api") a.apiCalls += 1;
      if (ev.kind === "api" && isError(ev.result)) a.errors += 1;
      a.firstAt = Math.min(a.firstAt, t);
      if (t >= a.lastAt) {
        a.lastAt = t;
        a.sessionId = ev.sessionId;
        a.lastAction = describeAction(ev);
        if (ev.kind !== "api" && ev.screen) a.lastScreen = ev.screen;
      }
      a.email = a.email ?? ev.email;
      a.userId = a.userId ?? ev.userId;
      a.platform = ev.platform ?? a.platform;
      a.appVersion = ev.appVersion ?? a.appVersion;
    }
  }

  prune(nowMs: number): void {
    const minSec = Math.floor(nowMs / 1000) - KEEP_SECONDS;
    for (const m of [...this.services.values(), ...this.serviceUsers.values()]) {
      for (const sec of m.keys()) if (sec < minSec) m.delete(sec);
    }
    for (const [k, a] of this.agents) if (nowMs - a.lastAt > AGENT_KEEP_MS) this.agents.delete(k);
  }

  snapshot(nowMs: number, services: string[]): LiveSnapshot {
    this.prune(nowMs);
    const nowSec = Math.floor(nowMs / 1000);
    const names = [...new Set([...services, ...this.services.keys()])].filter((s) => s !== "CUSTOM" || this.services.has(s));
    let calls1mAll = 0;
    let errors1mAll = 0;
    const out: ServiceLive[] = names.map((service) => {
      const buckets = this.services.get(service) ?? new Map<number, Bucket>();
      let calls1m = 0, errors1m = 0, calls5m = 0, errors5m = 0, latSum1m = 0;
      const lat1m: number[] = [];
      const series = Array.from({ length: 15 }, () => ({ calls: 0, errors: 0 }));
      for (const [sec, b] of buckets) {
        const age = nowSec - sec;
        if (age < 0 || age >= KEEP_SECONDS) continue;
        const minuteIdx = 14 - Math.floor(age / 60);
        series[minuteIdx]!.calls += b.calls;
        series[minuteIdx]!.errors += b.errors;
        if (age < 300) {
          calls5m += b.calls;
          errors5m += b.errors;
        }
        if (age < 60) {
          calls1m += b.calls;
          errors1m += b.errors;
          latSum1m += b.latSum;
          lat1m.push(...b.lat);
        }
      }
      const users = new Set<string>();
      for (const [sec, set] of this.serviceUsers.get(service) ?? []) {
        if (nowSec - sec < 60) for (const u of set) users.add(u);
      }
      calls1mAll += calls1m;
      errors1mAll += errors1m;
      const rate5m = calls5m ? errors5m / calls5m : null;
      return {
        service,
        status: rate5m == null ? "idle" : errorRateToDisplayStatus(rate5m, service),
        calls1m,
        errors1m,
        errorRate1m: calls1m ? errors1m / calls1m : null,
        errorRate5m: rate5m,
        calls5m,
        p95Ms1m: p95(lat1m),
        avgMs1m: calls1m ? Math.round(latSum1m / calls1m) : null,
        agents1m: users.size,
        series,
      };
    });
    let online = 0;
    for (const a of this.agents.values()) if (nowMs - a.lastAt <= AGENT_ONLINE_MS) online += 1;
    return {
      at: new Date(nowMs).toISOString(),
      agentsOnline: online,
      callsPerMin: calls1mAll,
      errorsPerMin: errors1mAll,
      services: out,
    };
  }

  agentList(nowMs: number, limit = 200): (AgentPresence & { online: boolean })[] {
    this.prune(nowMs);
    return [...this.agents.values()]
      .sort((a, b) => b.lastAt - a.lastAt)
      .slice(0, limit)
      .map((a) => ({ ...a, online: nowMs - a.lastAt <= AGENT_ONLINE_MS }));
  }
}

const projects = new Map<string, ProjectStats>();

export function statsFor(projectId: string): ProjectStats {
  let s = projects.get(projectId);
  if (!s) projects.set(projectId, (s = new ProjectStats()));
  return s;
}

export function recordLiveEvent(projectId: string, ev: LiveEvent): void {
  statsFor(projectId).record(ev);
}

/** Test hook. */
export function resetLiveStats(): void {
  projects.clear();
}

export type { ProjectStats };
