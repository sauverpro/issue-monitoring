import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { assessRetention, causeOf, flagScreens, isLoginLoop, type ReportQuality } from "../src/services/reportQuality.js";
import { renderExecutiveReportPdf } from "../src/services/monitorExecutiveReportPdf.js";

describe("causeOf", () => {
  it("separates auth, client, server, network and unclassified", () => {
    assert.equal(causeOf(502, "/wallet/balance/1"), "server");
    assert.equal(causeOf(401, "/api/v1/dcc/stock"), "auth");
    assert.equal(causeOf(400, "/api/v1/auth/login"), "auth");
    assert.equal(causeOf(422, "/api/v1/otp/verify"), "auth");
    assert.equal(causeOf(404, "/api/v1/stock-orders"), "client");
    assert.equal(causeOf(0, "/intelligrapi/x", true), "network");
    assert.equal(causeOf(0, "/intelligrapi/x"), "unclassified");
    assert.equal(causeOf(null, "/x"), "unclassified");
  });

  it("does not treat words containing auth fragments as auth paths", () => {
    assert.equal(causeOf(404, "/api/v1/authors"), "client");
    assert.equal(causeOf(404, "/api/v1/pinned"), "client");
  });
});

describe("assessRetention", () => {
  const end = new Date("2026-10-01T00:00:00Z");

  it("weights by users and only counts cohorts whose return window was observed", () => {
    const r = assessRetention(
      [
        { date: "2026-09-20", users: 100, returned1d: 20, returned7d: 5 },
        { date: "2026-09-21", users: 10, returned1d: 9, returned7d: 0 },
        // next day (Oct 1) not complete at `end` → excluded from D1 and D7
        { date: "2026-09-30", users: 50, returned1d: 0, returned7d: 0 },
      ],
      end
    );
    assert.equal(r.d1Cohorts, 2);
    assert.equal(r.d1Users, 110);
    assert.equal(r.d1Rate, 29 / 110);
    assert.equal(r.d7Cohorts, 2);
    assert.equal(r.firstCohort, "2026-09-20");
    assert.equal(r.lastCohort, "2026-09-30");
  });

  it("declares a handful of small late cohorts not representative of a quarter", () => {
    const days = Array.from({ length: 92 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 6, 1 + i)).toISOString().slice(0, 10);
      return { date: d, users: i >= 84 ? 28 : 0, returned1d: i >= 84 ? 3 : 0, returned7d: 0 };
    });
    const r = assessRetention(days, end);
    assert.equal(r.representative, false);
    assert.match(r.reason, /daily cohorts|users|covers/);
  });

  it("accepts a well-populated period", () => {
    const days = Array.from({ length: 28 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10),
      users: 40,
      returned1d: 10,
      returned7d: 4,
    }));
    const r = assessRetention(days, new Date("2026-10-15T00:00:00Z"));
    assert.equal(r.representative, true);
    assert.equal(r.d1Rate, 0.25);
  });
});

describe("screen naming flags", () => {
  it("flags generic shells, auth screens, duplicates and id routes", () => {
    const f = flagScreens(["DCC Dashboard Access", "/", "Login Screen", "Login Screen Setup", "/inventory", "/request-product/cmj9ppqvq0000ox7ihthoh656", "(unknown)"]);
    assert.deepEqual(f.get("DCC Dashboard Access"), ["generic"]);
    assert.deepEqual(f.get("/"), ["generic"]);
    assert.deepEqual(f.get("Login Screen"), ["auth", "duplicate"]);
    assert.deepEqual(f.get("Login Screen Setup"), ["auth", "duplicate"]);
    assert.deepEqual(f.get("/request-product/cmj9ppqvq0000ox7ihthoh656"), ["id-route"]);
    assert.deepEqual(f.get("(unknown)"), ["unnamed"]);
    assert.equal(f.has("/inventory"), false);
  });

  it("detects login loops", () => {
    assert.equal(isLoginLoop(["Login Screen", "/", "DCC Dashboard Access", "Login Screen"]), true);
    assert.equal(isLoginLoop(["Login Screen", "/", "/inventory"]), false);
    assert.equal(isLoginLoop(["Login Screen", "Login Screen Setup"]), false);
  });
});

/** Decompressed text of all content streams, so assertions see what was drawn. */
function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  let out = raw;
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(raw))) {
    try {
      out += inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      /* not compressed */
    }
  }
  // Join the drawn text runs (wrapped lines become one string) and undo PDF escaping.
  const runs = [...out.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((r) => r[1]!);
  return runs.join(" ").replace(/\\([()\\])/g, "$1");
}

describe("executive report with incomplete-request causes", () => {
  const kpi = (value: number, delta: number | null = null) => ({ value, previous: value, delta, sparkline: [value, value] });
  const overview = {
    range: { from: "2026-07-01T00:00:00.000Z", to: "2026-09-30T23:59:59.999Z" },
    previous: { from: "2026-04-01T00:00:00.000Z", to: "2026-06-30T23:59:59.999Z" },
    hasEvents: true,
    kpis: { users: kpi(2861, 10), sessions: kpi(26876, 12), actions: kpi(50000), apiRequests: kpi(78800), errors: kpi(10706), avgLatencyMs: kpi(900), avgDurationMs: kpi(200000) },
    daily: [{ date: "2026-09-30", users: 100, sessions: 300, durationMs: 1000, actions: 900, apiRequests: 1200, errors: 120, avgLatencyMs: 700 }],
    actionsByType: [],
    topScreens: [],
    topApis: [],
    errorsByType: [{ type: "4xx", count: 7321 }, { type: "5xx", count: 142 }],
    topUsers: [],
  };
  const quality: ReportQuality = {
    totalRequests: 78800,
    incomplete: 10706,
    causes: [
      { cause: "auth", label: "Authentication / session (401, 403, failed login)", meaning: "Wrong credentials.", count: 4560, users: 1200, share: 0.426, topEndpoints: [] },
      { cause: "client", label: "Client / validation (other 4xx)", meaning: "Bad input.", count: 2761, users: 800, share: 0.258, topEndpoints: [] },
      { cause: "server", label: "Server failure (5xx)", meaning: "Server failed.", count: 142, users: 60, share: 0.013, topEndpoints: [] },
      { cause: "network", label: "No response (network / timeout)", meaning: "No response.", count: 600, users: 300, share: 0.056, topEndpoints: [] },
      { cause: "unclassified", label: "Unclassified (no HTTP status)", meaning: "Unknown.", count: 2643, users: 700, share: 0.247, topEndpoints: [] },
    ],
    serviceFailureRate: 742 / 78800,
    serviceFailureRateUpper: (742 + 2643) / 78800,
    serviceAvailability: 1 - 742 / 78800,
    clientRejectionRate: 7321 / 78800,
    testTraffic: { requests: 2282, failed: 2282 },
    login: { attempts: 2313, failed: 470, usersFailed: 300, usersFailedRepeatedly: 40 },
    retryFailures: 3000,
    sessionsTotal: 26876,
    sessionsCompletedWork: 15000,
    usersTotal: 2861,
    usersCompletedWork: 2500,
    loginLoopSessions: 262,
    byService: [],
    daily: [{ date: "2026-09-30", serviceFailures: 10, authFailures: 50, clientFailures: 30 }],
  };
  const base = {
    projectName: "Marketplace",
    overview: overview as any,
    funnels: { steps: [], transitions: [], conversion: 0.5, dropoff: null } as any,
    retention: {
      days: Array.from({ length: 8 }, (_, i) => ({ date: `2026-09-${23 + i}`, users: 28, returned1d: 3, returned7d: 1, rate1d: 0.1, rate7d: 0.03 })),
    } as any,
    dashboard: { health: { availability: 0.864, availabilityDelta: null, avgLatencyMs: 900, latencyDelta: null, errorRate: 0.136, errorRateDelta: null } } as any,
    problems: {
      summary: { totalErrors: 10706, totalErrorsDelta: null, usersAffected: 1084, usersAffectedDelta: null, errors5xx: 142, errors5xxDelta: null, critical: 0, usersInRange: 2861 },
      priority: { critical: 0, high: 30, medium: 50, low: 0 },
      errors: [{ method: "POST", path: "/api/v1/auth/login", statusCode: 401, occurrences: 470, usersAffected: 300, sessionsAffected: 400, severity: "high" }],
      slow: [],
    } as any,
    performance: { kpis: { avgLatencyMs: 900, avgDelta: null, p95Ms: 2000, p95Delta: null, p99Ms: 5000, p99Delta: null, slowApis: 3, slowDelta: null }, latency: [], latencyUnit: "day", endpoints: [] } as any,
    behavior: {
      screens: [
        { screen: "DCC Dashboard Access", views: 996, users: 500 },
        { screen: "Login Screen Setup", views: 972, users: 500 },
        { screen: "Login Screen", views: 816, users: 400 },
        { screen: "/inventory", views: 256, users: 120 },
      ],
      journeys: [{ path: ["Login Screen", "/", "DCC Dashboard Access", "Login Screen"], count: 95, pct: 0.18 }],
      sessionsSampled: 522,
    } as any,
  };

  it("frames incomplete requests by cause and judges reliability on service failures", () => {
    const text = pdfText(renderExecutiveReportPdf({ ...base, quality }));
    assert.match(text, /Incomplete requests by cause/);
    assert.match(text, /TOTAL INCOMPLETE REQUESTS/);
    assert.match(text, /Service failure rate/);
    assert.match(text, /5xx \+ no response/);
    assert.match(text, /rejected because of the request itself/);
    assert.match(text, /Login loop/);
    assert.match(text, /Generic shell/);
    assert.match(text, /Retention is indicative only/);
    assert.match(text, /mock\/sandbox/);
    assert.match(text, /Report at a Glance/);
    // Old misleading language is gone.
    assert.doesNotMatch(text, /Total errors/);
    assert.doesNotMatch(text, /No significant funnel drop-off/);
    assert.doesNotMatch(text, /\(Slow\)|\bSlow\b/);
    assert.doesNotMatch(text, /move out of Critical/);
  });

  it("does not call a period dominated by client rejections a server reliability crisis", () => {
    const text = pdfText(renderExecutiveReportPdf({ ...base, quality }));
    assert.doesNotMatch(text, /CRITICAL - /);
    // Fixture: 99.06% service availability vs the default 95% pilot target.
    assert.match(text, /ON TARGET - 99\.06% vs pilot target 95%/);
    assert.match(text, /long-term goal is 99\.5%/);
  });
});
