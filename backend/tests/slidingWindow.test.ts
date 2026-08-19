import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorRateToDisplayStatus } from "../src/services/slidingWindow.js";
import { RATE_DEGRADED_MIN, RATE_DOWN_MIN } from "../src/constants.js";

describe("errorRateToDisplayStatus", () => {
  it("is operational below the degraded threshold", () => {
    assert.equal(errorRateToDisplayStatus(0), "operational");
    assert.equal(errorRateToDisplayStatus(RATE_DEGRADED_MIN - 0.001), "operational");
  });

  it("is degraded at/above the degraded threshold and below the down threshold", () => {
    assert.equal(errorRateToDisplayStatus(RATE_DEGRADED_MIN), "degraded");
    assert.equal(errorRateToDisplayStatus(RATE_DOWN_MIN - 0.001), "degraded");
  });

  it("is down at/above the down threshold", () => {
    assert.equal(errorRateToDisplayStatus(RATE_DOWN_MIN), "down");
    assert.equal(errorRateToDisplayStatus(1), "down");
  });
});
