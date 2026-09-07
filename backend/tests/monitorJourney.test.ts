import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildJourneyMap,
  classifyKind,
  filterTimeline,
  groupActionsByDay,
  parseDateRange,
} from "../src/services/monitorJourney.js";
import type { SessionAction } from "../src/types/sessionInvestigation.js";

function action(partial: Partial<SessionAction>): SessionAction {
  return {
    id: partial.id ?? "1",
    timestamp: partial.timestamp ?? "2026-09-01T14:33:01.000Z",
    message: partial.message ?? null,
    type: partial.type ?? null,
    status: partial.status ?? null,
    actionType: partial.actionType ?? null,
    service: partial.service ?? null,
    method: partial.method ?? null,
    endpoint: partial.endpoint ?? null,
    httpStatus: partial.httpStatus ?? null,
    actionIndex: partial.actionIndex ?? 0,
    orderId: null,
    failureReason: partial.failureReason ?? null,
    role: null,
    accountType: null,
    screen: partial.screen ?? null,
    latencyMs: partial.latencyMs ?? null,
    sessionId: partial.sessionId ?? "s1",
  };
}

describe("parseDateRange", () => {
  it("uses a calendar date as UTC bounds", () => {
    const r = parseDateRange({ date: "2026-09-01" });
    assert.equal(r.from.toISOString(), "2026-09-01T00:00:00.000Z");
    assert.equal(r.to.toISOString(), "2026-09-01T23:59:59.999Z");
  });
});

describe("filterTimeline", () => {
  const rows = [
    action({
      id: "nav",
      actionType: "navigation",
      screen: "/events/123",
      timestamp: "2026-09-01T14:31:00.000Z",
    }),
    action({
      id: "ok",
      actionType: "api_call",
      method: "GET",
      endpoint: "/api/profile",
      status: "success",
      httpStatus: "200",
      latencyMs: 182,
      screen: "/dashboard",
    }),
    action({
      id: "fail",
      actionType: "api_call",
      method: "GET",
      endpoint: "/api/tickets",
      status: "failure",
      httpStatus: "500",
      latencyMs: 1823,
      screen: "/events/123",
    }),
  ];

  it("keeps only API failures", () => {
    const out = filterTimeline(rows, { kind: "api_failure" });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, "fail");
  });

  it("filters 5xx and slow calls", () => {
    const out = filterTimeline(rows, { statusClass: "5xx", minLatency: 1000 });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.id, "fail");
  });
});

describe("classifyKind", () => {
  it("labels failed APIs separately", () => {
    assert.equal(
      classifyKind(action({ actionType: "api_call", status: "failure" })),
      "api_failure"
    );
    assert.equal(classifyKind(action({ actionType: "navigation" })), "screen");
    assert.equal(classifyKind(action({ actionType: "click" })), "action");
  });

  it("buckets the new UI/behavior event kinds", () => {
    assert.equal(classifyKind(action({ actionType: "screen_view" })), "screen");
    assert.equal(classifyKind(action({ actionType: "logout" })), "session");
    assert.equal(classifyKind(action({ actionType: "form_start" })), "action");
    assert.equal(classifyKind(action({ actionType: "form_submit" })), "action");
    assert.equal(classifyKind(action({ actionType: "search" })), "action");
    assert.equal(classifyKind(action({ actionType: "filter" })), "action");
    assert.equal(classifyKind(action({ actionType: "modal_open" })), "action");
    assert.equal(classifyKind(action({ actionType: "modal_close" })), "action");
    assert.equal(classifyKind(action({ actionType: "download" })), "action");
    assert.equal(classifyKind(action({ actionType: "file_upload" })), "action");
    assert.equal(classifyKind(action({ actionType: "purchase_start" })), "action");
    assert.equal(classifyKind(action({ actionType: "purchase_complete" })), "action");
  });
});

describe("journey map and days", () => {
  it("groups screens and counts API outcomes", () => {
    const map = buildJourneyMap([
      action({ actionType: "navigation", screen: "/dashboard", timestamp: "2026-09-01T14:31:00Z" }),
      action({
        actionType: "api_call",
        status: "success",
        screen: "/dashboard",
        timestamp: "2026-09-01T14:31:05Z",
      }),
      action({ actionType: "navigation", screen: "/tickets", timestamp: "2026-09-01T14:33:00Z" }),
      action({
        actionType: "api_call",
        status: "failure",
        screen: "/tickets",
        timestamp: "2026-09-01T14:33:01Z",
      }),
    ]);
    assert.equal(map.length, 2);
    assert.equal(map[0]!.screen, "/dashboard");
    assert.equal(map[0]!.apiOk, 1);
    assert.equal(map[1]!.failed, true);
    assert.equal(map[1]!.apiFail, 1);
  });

  it("groups timeline by UTC date, newest day and event first", () => {
    const days = groupActionsByDay([
      action({ id: "a", timestamp: "2026-09-01T10:00:00.000Z", actionIndex: 1 }),
      action({ id: "c", timestamp: "2026-09-01T14:00:00.000Z", actionIndex: 2 }),
      action({ id: "b", timestamp: "2026-08-31T10:00:00.000Z" }),
    ]);
    assert.equal(days[0]!.date, "2026-09-01");
    assert.equal(days[0]!.actions[0]!.id, "c");
    assert.equal(days[1]!.date, "2026-08-31");
  });
});
