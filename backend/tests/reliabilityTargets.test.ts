import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_TARGETS, targetFor, targetsSchema, verdict } from "../src/services/reliabilityTargets.js";

describe("reliability targets", () => {
  it("defaults to pilot-phase targets with a long-term goal", () => {
    assert.deepEqual(DEFAULT_TARGETS, {
      phase: "Pilot",
      overall: 0.95,
      core: 0.97,
      thirdParty: 0.9,
      longTerm: 0.995,
      coreServices: ["KORALINK"],
    });
  });

  it("rates on / near (within 2 points) / below target", () => {
    assert.equal(verdict(0.96, 0.95), "on");
    assert.equal(verdict(0.95, 0.95), "on");
    assert.equal(verdict(0.9365, 0.95), "near");
    assert.equal(verdict(0.93, 0.95), "near");
    assert.equal(verdict(0.929, 0.95), "below");
    assert.equal(verdict(0.63, 0.9), "below");
  });

  it("uses the own-service target for core services and the third-party target otherwise", () => {
    assert.equal(targetFor(DEFAULT_TARGETS, "KORALINK"), 0.97);
    assert.equal(targetFor(DEFAULT_TARGETS, "koralink"), 0.97);
    assert.equal(targetFor(DEFAULT_TARGETS, "INTEGRA"), 0.9);
  });

  it("validates input and normalises service slugs", () => {
    const t = targetsSchema.parse({ overall: 0.9, coreServices: ["koralink", "mvend"] });
    assert.equal(t.overall, 0.9);
    assert.equal(t.core, 0.97);
    assert.deepEqual(t.coreServices, ["KORALINK", "MVEND"]);
    assert.equal(targetsSchema.safeParse({ overall: 1.5 }).success, false);
    assert.equal(targetsSchema.safeParse({ overall: 0.2 }).success, false);
  });
});
