import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSeverity } from "../src/services/incidents.js";

describe("computeSeverity", () => {
  it("is P1 when the service is down, regardless of rate", () => {
    assert.equal(computeSeverity(0.99, "down"), "P1");
    assert.equal(computeSeverity(0.6, "down"), "P1");
  });

  it("is P2 when degraded with rate >= 0.3", () => {
    assert.equal(computeSeverity(0.3, "degraded"), "P2");
    assert.equal(computeSeverity(0.59, "degraded"), "P2");
  });

  it("is P3 when degraded with rate < 0.3", () => {
    assert.equal(computeSeverity(0.05, "degraded"), "P3");
    assert.equal(computeSeverity(0.29, "degraded"), "P3");
  });

  it("is P4 when operational", () => {
    assert.equal(computeSeverity(0, "operational"), "P4");
  });
});
