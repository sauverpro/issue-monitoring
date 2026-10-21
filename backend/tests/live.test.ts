import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { describeAction, resetLiveStats, statsFor, type LiveEvent } from "../src/services/liveStats.js";
import { extractErrorMessage, statusMeaning } from "../src/services/reliability.js";
import { addLiveClient, publishLiveEvent, relayGlobalEvent } from "../src/sse/liveHub.js";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const ev = (over: Partial<LiveEvent>): LiveEvent => ({
  id: `e${Math.random()}`,
  kind: "api",
  at: new Date(NOW - 1000).toISOString(),
  sessionId: "s1",
  userKey: "agent-1",
  email: "a@x.rw",
  userId: "agent-1",
  service: "MVEND",
  method: "GET",
  path: "/wallet",
  status: 200,
  latencyMs: 100,
  result: "success",
  ...over,
});

describe("liveStats", () => {
  beforeEach(() => resetLiveStats());

  it("aggregates the last minute per service and uses payment thresholds", () => {
    const s = statsFor("p");
    s.record(ev({ latencyMs: 100 }));
    s.record(ev({ latencyMs: 300, status: 401, result: "client_failure", userKey: "agent-2" }));
    s.record(ev({ service: "KORALINK", latencyMs: 50 }));
    const snap = s.snapshot(NOW, ["MVEND", "KORALINK", "DDIN"]);
    const mvend = snap.services.find((x) => x.service === "MVEND")!;
    assert.equal(mvend.calls1m, 2);
    assert.equal(mvend.errors1m, 1);
    assert.equal(mvend.errorRate1m, 0.5);
    assert.equal(mvend.agents1m, 2);
    assert.equal(mvend.avgMs1m, 200);
    assert.equal(mvend.p95Ms1m, 300);
    assert.equal(mvend.status, "down"); // 50% ≥ 40% payment "down" threshold
    assert.equal(snap.services.find((x) => x.service === "DDIN")!.status, "idle");
    assert.equal(snap.callsPerMin, 3);
    assert.equal(snap.agentsOnline, 2);
  });

  it("places traffic into per-minute series and drops data older than 15 minutes", () => {
    const s = statsFor("p");
    s.record(ev({ at: new Date(NOW - 5 * 60_000 - 10).toISOString() }));
    s.record(ev({ at: new Date(NOW - 20 * 60_000).toISOString() }));
    const svc = s.snapshot(NOW, ["MVEND"]).services[0]!;
    assert.equal(svc.series.length, 15);
    assert.equal(svc.series.reduce((n, p) => n + p.calls, 0), 1);
    assert.equal(svc.series[9]!.calls, 1);
    assert.equal(svc.calls1m, 0);
  });

  it("counts each event id once (seed + live overlap)", () => {
    const s = statsFor("p");
    const e = ev({ id: "same" });
    s.record(e);
    s.record(e);
    assert.equal(s.snapshot(NOW, ["MVEND"]).services[0]!.calls1m, 1);
  });

  it("tracks agent presence with the latest action and screen", () => {
    const s = statsFor("p");
    s.record(ev({ kind: "navigation", service: undefined, screen: "/wallet", message: "/ -> /wallet", at: new Date(NOW - 3000).toISOString() }));
    s.record(ev({ status: 0, result: "network", at: new Date(NOW - 1000).toISOString() }));
    const [a] = s.agentList(NOW);
    assert.equal(a!.events, 2);
    assert.equal(a!.errors, 1);
    assert.equal(a!.lastScreen, "/wallet");
    assert.equal(a!.lastAction, "GET /wallet → network");
    assert.equal(a!.online, true);
    assert.equal(s.agentList(NOW + 6 * 60_000)[0]!.online, false);
  });

  it("describes actions", () => {
    assert.equal(describeAction(ev({ method: "POST", path: "/transfer", status: 404 })), "POST /transfer → 404");
    assert.equal(describeAction(ev({ kind: "click", message: "Clicked Send" })), "Clicked Send");
  });
});

/** Minimal Response stand-in that records SSE writes. */
function fakeRes() {
  const chunks: string[] = [];
  return { chunks, res: { write: (c: string) => (chunks.push(c), true) } as never };
}

describe("liveHub", () => {
  beforeEach(() => resetLiveStats());

  it("filters by agent and service and relays incidents only to projects using the service", async () => {
    const all = fakeRes();
    const agent = fakeRes();
    const koralinkOnly = fakeRes();
    const otherProject = fakeRes();
    const removers = [
      addLiveClient({ res: all.res, projectId: "p1", allowedServices: ["MVEND", "KORALINK"] }),
      addLiveClient({ res: agent.res, projectId: "p1", allowedServices: ["MVEND", "KORALINK"], userKey: "agent-2" }),
      addLiveClient({ res: koralinkOnly.res, projectId: "p1", allowedServices: ["MVEND", "KORALINK"], services: ["KORALINK"] }),
      addLiveClient({ res: otherProject.res, projectId: "p2", allowedServices: ["DDIN"] }),
    ];
    publishLiveEvent("p1", ev({ id: "x1" }));
    publishLiveEvent("p1", ev({ id: "x2", userKey: "agent-2", kind: "click", service: undefined, message: "Send" }));
    relayGlobalEvent("incident_opened", { service: "MVEND", severity: "P1" });
    await new Promise((r) => setTimeout(r, 1100));
    const text = (f: { chunks: string[] }) => f.chunks.join("");
    assert.match(text(all), /"x1"/);
    assert.match(text(all), /"x2"/);
    assert.doesNotMatch(text(agent), /"x1"/);
    assert.match(text(agent), /"x2"/);
    assert.doesNotMatch(text(koralinkOnly), /"x1"|"x2"/); // MVEND api + non-api filtered out
    assert.doesNotMatch(text(koralinkOnly), /incident_opened/);
    assert.match(text(all), /incident_opened/);
    assert.equal(text(otherProject), "");
    removers.forEach((r) => r());
  });

  it("replays missed events after Last-Event-ID", () => {
    publishLiveEvent("p3", ev({ id: "before" }));
    const future = Number.MAX_SAFE_INTEGER; // nothing is newer than this
    const f = fakeRes();
    const remove = addLiveClient({ res: f.res, projectId: "p3", allowedServices: ["MVEND"], lastEventId: 0 });
    assert.match(f.chunks.join(""), /"before"/);
    remove();
    const g = fakeRes();
    const remove2 = addLiveClient({ res: g.res, projectId: "p3", allowedServices: ["MVEND"], lastEventId: future });
    assert.equal(g.chunks.join(""), "");
    remove2();
  });
});

describe("payment helpers", () => {
  it("explains statuses in plain language", () => {
    assert.equal(statusMeaning(401).label, "Login expired");
    assert.equal(statusMeaning(null).label, "No response");
    assert.equal(statusMeaning(0).label, "No response");
    assert.equal(statusMeaning(503).label, "Provider error");
    assert.equal(statusMeaning(400).label, "Invalid request");
  });

  it("extracts a readable error message", () => {
    assert.equal(extractErrorMessage(null, '{"message":"Token expired"}'), "Token expired");
    assert.equal(extractErrorMessage(null, '{"error":{"message":"Wallet not found"}}'), "Wallet not found");
    assert.equal(extractErrorMessage("Insufficient balance", '{"message":"x"}'), "Insufficient balance");
    assert.equal(extractErrorMessage("network", null), "network");
    assert.equal(extractErrorMessage(null, "<html>Bad   Gateway</html>"), "<html>Bad Gateway</html>");
    assert.equal(extractErrorMessage(null, null), null);
  });
});
