import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  apiOpsStatus,
  classifyHttpResult,
} from "../src/services/httpResultClass.js";

describe("classifyHttpResult", () => {
  it("classes 2xx/3xx as success and 4xx/5xx separately", () => {
    assert.equal(classifyHttpResult(200), "success");
    assert.equal(classifyHttpResult(301), "success");
    assert.equal(classifyHttpResult(404), "client_failure");
    assert.equal(classifyHttpResult(500), "server_error");
  });

  it("uses outcome when status is 0", () => {
    assert.equal(classifyHttpResult(0, "SUCCESS"), "success");
    assert.equal(classifyHttpResult(0, "FAILURE"), "client_failure");
    assert.equal(classifyHttpResult(0, "OTHER"), "network");
    assert.equal(classifyHttpResult(0, null), "network");
  });
});

describe("apiOpsStatus", () => {
  it("marks idle / healthy / critical", () => {
    assert.equal(
      apiOpsStatus({ success: 0, clientFailure: 0, serverError: 0, network: 0 }),
      "idle"
    );
    assert.equal(
      apiOpsStatus({ success: 100, clientFailure: 5, serverError: 0, network: 0 }),
      "healthy"
    );
    assert.equal(
      apiOpsStatus({ success: 50, clientFailure: 0, serverError: 20, network: 0 }),
      "critical"
    );
  });
});
