import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveOutcome, classifyNetworkFailure } from "./mapping.js";

describe("outcome mapping", () => {
  it("maps http and network", () => {
    assert.equal(deriveOutcome(201), "SUCCESS");
    assert.equal(deriveOutcome(401), "FAILURE");
    assert.equal(deriveOutcome(0), "OTHER");
    assert.equal(classifyNetworkFailure(new Error("Failed to fetch")), "offline");
  });
});
