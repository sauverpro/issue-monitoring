import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionSummary,
  extractFailures,
  actionOutcome,
  isApiCall,
} from "../src/services/sessionSummary.js";
import {
  sortActionsByIndex,
  rowToSessionAction,
} from "../src/services/sentry/sentryClient.js";
import { cacheSet, cacheGet, cacheKeySession } from "../src/services/cache.js";

describe("sessionSummary", () => {
  const actions = [
    {
      id: "1",
      timestamp: "2026-01-01T10:00:00Z",
      message: null,
      type: "api_success",
      status: "success",
      actionType: "api_call",
      service: "auth",
      method: "GET",
      endpoint: "https://example.com/a",
      httpStatus: "200",
      actionIndex: 1,
      orderId: null,
      failureReason: null,
      role: "DCC",
      accountType: "Agent",
    },
    {
      id: "2",
      timestamp: "2026-01-01T10:01:00Z",
      message: null,
      type: "api_failure",
      status: "failure",
      actionType: "api_call",
      service: "marketplace",
      method: "GET",
      endpoint: "https://example.com/b",
      httpStatus: "500",
      actionIndex: 2,
      orderId: null,
      failureReason: "Server error",
      role: "DCC",
      accountType: "Agent",
    },
  ];

  it("builds summary counts", () => {
    const s = buildSessionSummary(actions);
    assert.equal(s.totalActions, 2);
    assert.equal(s.successfulActions, 1);
    assert.equal(s.failedActions, 1);
    assert.equal(s.apiCalls, 2);
    assert.equal(s.errorRate, 0.5);
    assert.equal(s.startedAt, "2026-01-01T10:00:00Z");
    assert.equal(s.endedAt, "2026-01-01T10:01:00Z");
  });

  it("extracts failures", () => {
    const f = extractFailures(actions);
    assert.equal(f.length, 1);
    assert.equal(f[0]!.failureReason, "Server error");
  });

  it("classifies outcomes", () => {
    assert.equal(actionOutcome(actions[0]!), "success");
    assert.equal(actionOutcome(actions[1]!), "failure");
  });
});

describe("isApiCall", () => {
  it("never misclassifies the new UI/behavior kinds as API calls", () => {
    for (const actionType of ["purchase_start", "purchase_complete", "search", "form_submit"]) {
      assert.equal(
        isApiCall({
          id: "x",
          timestamp: "2026-01-01T10:00:00Z",
          message: null,
          type: null,
          status: null,
          actionType,
          service: null,
          method: null,
          endpoint: null,
          httpStatus: null,
          actionIndex: 0,
          orderId: null,
          failureReason: null,
          role: null,
          accountType: null,
        } as never),
        false
      );
    }
  });
});

describe("sentryClient", () => {
  it("sorts by action_index", () => {
    const sorted = sortActionsByIndex([
      { actionIndex: 3, timestamp: "b" } as never,
      { actionIndex: 1, timestamp: "a" } as never,
    ]);
    assert.equal(sorted[0]!.actionIndex, 1);
  });

  it("skips external_* duplicate types", () => {
    const row = {
      id: "abc",
      timestamp: "2026-01-01T00:00:00Z",
      "tags[type]": "external_api_failure",
      "tags[session_id]": "sess_1",
      "tags[action_index]": "1",
    };
    assert.equal(rowToSessionAction(row), null);
  });

  it("maps discover row to action", () => {
    const row = {
      id: "abc",
      timestamp: "2026-01-01T00:00:00Z",
      "tags[type]": "api_success",
      "tags[status]": "success",
      "tags[session_id]": "sess_1",
      "tags[action_index]": "2",
      "tags[endpoint]": "https://example.com/x",
      "tags[service]": "gwiza",
    };
    const action = rowToSessionAction(row);
    assert.ok(action);
    assert.equal(action!.actionIndex, 2);
    assert.equal(action!.service, "gwiza");
  });
});

describe("cache", () => {
  it("stores and retrieves with TTL", () => {
    const key = cacheKeySession("sess_test");
    cacheSet(key, { ok: true }, 60_000);
    assert.deepEqual(cacheGet(key), { ok: true });
  });
});
