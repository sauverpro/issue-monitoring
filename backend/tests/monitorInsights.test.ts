import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildRecommendations,
  encodeProblemKey,
  largestDropoff,
  parseProblemKey,
  problemSeverity,
  rankJourneys,
  sequentialFunnel,
} from "../src/services/monitorInsights.js";

describe("problemSeverity", () => {
  it("marks high-volume 500s as critical", () => {
    assert.equal(
      problemSeverity({ statusCode: 500, occurrences: 100, usersAffected: 40 }),
      "critical"
    );
    assert.equal(problemSeverity({ statusCode: 500, occurrences: 5, usersAffected: 2 }), "high");
  });
});

describe("problem keys", () => {
  it("round-trips method path status", () => {
    const key = encodeProblemKey("GET", "/api/tickets", 500);
    const parsed = parseProblemKey(key);
    assert.equal(parsed.method, "GET");
    assert.equal(parsed.path, "/api/tickets");
    assert.equal(parsed.statusCode, 500);
  });
});

describe("sequentialFunnel", () => {
  it("follows the highest transition chain", () => {
    const steps = sequentialFunnel(
      { screen: "/dashboard", sessions: 100 },
      [
        { from: "/dashboard", to: "/events", count: 80 },
        { from: "/events", to: "/tickets", count: 50 },
        { from: "/dashboard", to: "/pay", count: 10 },
      ]
    );
    assert.equal(steps.length, 3);
    assert.equal(steps[1]!.screen, "/events");
    assert.equal(steps[2]!.screen, "/tickets");
    assert.equal(steps[1]!.conversion, 0.8);
  });

  it("finds largest drop-off", () => {
    const steps = sequentialFunnel(
      { screen: "A", sessions: 100 },
      [
        { from: "A", to: "B", count: 80 },
        { from: "B", to: "C", count: 20 },
      ]
    );
    const drop = largestDropoff(steps);
    assert.ok(drop);
    assert.equal(drop!.from, "B");
    assert.equal(drop!.to, "C");
    assert.ok(drop!.rate > 0.7);
  });
});

describe("rankJourneys", () => {
  it("ranks repeated screen paths", () => {
    const rows = rankJourneys([
      ["/a", "/b", "/c"],
      ["/a", "/b", "/c"],
      ["/a", "/x"],
    ]);
    assert.equal(rows[0]!.path.join(" → "), "/a → /b → /c");
    assert.equal(rows[0]!.count, 2);
    assert.equal(rows[0]!.pct, 2 / 3);
  });
});

describe("buildRecommendations", () => {
  it("emits P0/P1/P2 items", () => {
    const recs = buildRecommendations({
      errors: [
        {
          severity: "critical",
          method: "GET",
          path: "/api/tickets",
          occurrences: 642,
          usersAffected: 95,
        },
      ],
      slow: [{ method: "GET", path: "/api/tickets", p95Ms: 2310 }],
      dropoff: { from: "Tickets", to: "Checkout", fromCount: 3868, toCount: 2421, rate: 0.37 },
    });
    assert.ok(recs.some((r) => r.priority === "P0"));
    assert.ok(recs.some((r) => r.priority === "P1"));
    assert.ok(recs.some((r) => r.priority === "P2"));
  });
});
