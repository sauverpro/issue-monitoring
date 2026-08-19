import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPingResult } from "../src/services/syntheticPing.js";

describe("classifyPingResult", () => {
  it("tolerates a single failure without transitioning", () => {
    const r = classifyPingResult(true, 0, false, 2);
    assert.equal(r.nextFailStreak, 1);
    assert.equal(r.transition, "none");
  });

  it("transitions to down once the fail streak reaches the threshold", () => {
    const r = classifyPingResult(true, 1, false, 2);
    assert.equal(r.nextFailStreak, 2);
    assert.equal(r.transition, "down");
  });

  it("stays down (no repeat transition) on further failures", () => {
    const r = classifyPingResult(false, 2, false, 2);
    assert.equal(r.nextFailStreak, 3);
    assert.equal(r.transition, "none");
  });

  it("transitions to recovered on the first success after being down", () => {
    const r = classifyPingResult(false, 3, true, 2);
    assert.equal(r.nextFailStreak, 0);
    assert.equal(r.transition, "recovered");
  });

  it("stays quiet on success while already healthy", () => {
    const r = classifyPingResult(true, 0, true, 2);
    assert.equal(r.nextFailStreak, 0);
    assert.equal(r.transition, "none");
  });
});
