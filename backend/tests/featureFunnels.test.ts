import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FUNNEL_TEMPLATES,
  computeSequentialFunnel,
  funnelDefSchema,
  pathPatternToRegex,
  screenLikePattern,
  type StepHit,
} from "../src/services/featureFunnels.js";

const labels = [
  { label: "Preview", type: "api" as const },
  { label: "Place", type: "api" as const },
  { label: "Receive", type: "api" as const },
];

const hit = (userKey: string, at: number, ok = true): StepHit => ({ userKey, at, ok });

describe("pathPatternToRegex", () => {
  const matches = (pattern: string, path: string) => new RegExp(pathPatternToRegex(pattern), "i").test(path);

  it("matches the path at the end regardless of base prefix", () => {
    assert.ok(matches("/stock-orders", "/api/v1/stock-orders"));
    assert.ok(matches("/stock-orders", "/api/v1/stock-orders/"));
    assert.ok(matches("/stock-orders", "/api/v1/stock-orders?page=2"));
  });

  it("does not match longer paths", () => {
    assert.ok(!matches("/stock-orders", "/api/v1/stock-orders/preview"));
    assert.ok(!matches("/transfer", "/transfer/validatesend"));
  });

  it("treats {id} and * as exactly one segment", () => {
    assert.ok(matches("/stock-orders/{id}/received", "/api/v1/stock-orders/cmj9ppqvq0000/received"));
    assert.ok(matches("/contracts/*/otp", "/api/v1/contracts/abc/otp"));
    assert.ok(!matches("/contracts/{id}/otp", "/api/v1/contracts/abc/otp/verify"));
    assert.ok(!matches("/contracts/{id}/otp", "/api/v1/contracts/a/b/otp"));
  });

  it("escapes regex metacharacters in literal parts", () => {
    assert.ok(!matches("/a.b", "/axb"));
    assert.ok(matches("/a.b", "/a.b"));
  });
});

describe("screenLikePattern", () => {
  it("builds ILIKE patterns per match mode", () => {
    assert.equal(screenLikePattern("exact", "/wallet"), "/wallet");
    assert.equal(screenLikePattern("prefix", "/wallet"), "/wallet%");
    assert.equal(screenLikePattern("contains", "wallet"), "%wallet%");
  });

  it("escapes LIKE wildcards in the value", () => {
    assert.equal(screenLikePattern("prefix", "/100%_off"), "/100\\%\\_off%");
  });
});

describe("computeSequentialFunnel", () => {
  it("counts users who progress through steps in order", () => {
    const r = computeSequentialFunnel(labels, [
      [hit("a", 1), hit("b", 1), hit("c", 1)],
      [hit("a", 2), hit("b", 2)],
      [hit("a", 3)],
    ]);
    assert.deepEqual(
      r.steps.map((s) => s.users),
      [3, 2, 1]
    );
    assert.equal(r.started, 3);
    assert.equal(r.completed, 1);
    assert.equal(r.completionRate, 1 / 3);
    assert.equal(r.steps[1]!.conversionFromPrev, 2 / 3);
    assert.equal(r.steps[2]!.conversionFromPrev, 1 / 2);
  });

  it("ignores later steps that happened before the prior step", () => {
    const r = computeSequentialFunnel(labels, [[hit("a", 10)], [hit("a", 5)], [hit("a", 20)]]);
    assert.deepEqual(
      r.steps.map((s) => s.users),
      [1, 0, 0]
    );
  });

  it("uses the earliest qualifying hit after the previous step", () => {
    const r = computeSequentialFunnel(labels, [[hit("a", 10)], [hit("a", 5), hit("a", 12), hit("a", 30)], [hit("a", 15)]]);
    assert.equal(r.completed, 1);
    assert.equal(r.medianCompletionMs, 5);
  });

  it("reports users who attempted a step but never succeeded", () => {
    const r = computeSequentialFunnel(labels, [
      [hit("a", 1), hit("b", 1)],
      [hit("a", 2, false), hit("a", 3, false), hit("b", 2)],
      [],
    ]);
    assert.equal(r.steps[1]!.users, 1);
    assert.equal(r.steps[1]!.failedUsers, 1);
  });

  it("does not let a failed entry hit start the funnel", () => {
    const r = computeSequentialFunnel(labels, [[hit("a", 1, false)], [hit("a", 2)], [hit("a", 3)]]);
    assert.equal(r.started, 0);
    assert.equal(r.completionRate, 0);
  });

  it("finds the largest drop-off", () => {
    const r = computeSequentialFunnel(labels, [
      [hit("a", 1), hit("b", 1), hit("c", 1), hit("d", 1)],
      [hit("a", 2), hit("b", 2), hit("c", 2)],
      [hit("a", 3)],
    ]);
    assert.deepEqual(r.biggestDrop, { from: "Place", to: "Receive", lost: 2, rate: 2 / 3 });
  });

  it("handles empty input", () => {
    const r = computeSequentialFunnel(labels, [[], [], []]);
    assert.equal(r.started, 0);
    assert.equal(r.biggestDrop, null);
    assert.equal(r.medianCompletionMs, null);
  });
});

describe("FUNNEL_TEMPLATES", () => {
  it("are all valid funnel definitions", () => {
    for (const t of FUNNEL_TEMPLATES) {
      assert.ok(funnelDefSchema.safeParse(t).success, t.key);
    }
  });

  it("cover the workplan features", () => {
    const features = new Set(FUNNEL_TEMPLATES.map((t) => t.feature));
    for (const f of ["ordering", "contracting", "coupons"]) assert.ok(features.has(f), f);
  });
});
