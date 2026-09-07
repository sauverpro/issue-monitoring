import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderMonitorReportPdf } from "../src/services/monitorReportPdf.js";
import { pdfSafe, pdfString, SimplePdf } from "../src/services/simplePdf.js";

function kpi(value: number, sparkline: number[]) {
  return { value, previous: Math.max(0, value - 2), delta: 5, sparkline };
}

const baseOverview = {
  range: { from: "2026-08-25T00:00:00.000Z", to: "2026-09-01T23:59:59.999Z" },
  previous: { from: "2026-08-17T00:00:00.000Z", to: "2026-08-24T23:59:59.998Z" },
  hasEvents: true,
  kpis: {
    users: kpi(42, [3, 5, 8, 6, 9, 7, 10, 8]),
    sessions: kpi(90, [10, 12, 8, 14, 11, 9, 16, 10]),
    actions: kpi(400, [40, 50, 30, 60, 55, 48, 70, 47]),
    apiRequests: kpi(1200, [100, 140, 90, 180, 160, 150, 200, 180]),
    errors: kpi(12, [1, 0, 2, 3, 1, 0, 4, 1]),
    avgLatencyMs: kpi(180, [160, 170, 190, 200, 175, 168, 210, 180]),
    avgDurationMs: kpi(45000, [40000, 42000, 48000, 50000, 44000, 43000, 46000, 45000]),
  },
  daily: [
    {
      date: "2026-08-25",
      users: 5,
      sessions: 10,
      durationMs: 40000,
      actions: 40,
      apiRequests: 100,
      errors: 1,
      avgLatencyMs: 160,
    },
    {
      date: "2026-08-26",
      users: 8,
      sessions: 12,
      durationMs: 42000,
      actions: 50,
      apiRequests: 140,
      errors: 0,
      avgLatencyMs: 170,
    },
  ],
  actionsByType: [
    { kind: "navigation", count: 120 },
    { kind: "click", count: 80 },
    { kind: "api", count: 200 },
  ],
  topScreens: [
    { screen: "/home", count: 40, pct: 0.4 },
    { screen: "/pay", count: 30, pct: 0.3 },
  ],
  topApis: [
    { method: "GET", path: "/v1/users", requests: 120, avgLatencyMs: 80, errorRate: 0.02 },
    { method: "POST", path: "/v1/pay", requests: 40, avgLatencyMs: 220, errorRate: 0.1 },
  ],
  errorsByType: [
    { type: "5xx", count: 3 },
    { type: "4xx", count: 8 },
  ],
  topUsers: [
    {
      userKey: "a@b.com",
      userId: "u1",
      email: "a@b.com",
      sessions: 4,
      actions: 20,
      errors: 1,
    },
  ],
};

const baseFunnels = {
  steps: [
    { screen: "/home", users: 40, conversion: 1 },
    { screen: "/pay", users: 22, conversion: 0.55 },
  ],
  transitions: [{ from: "/home", to: "/pay", count: 22 }],
  conversion: 0.55,
  dropoff: null,
};

const baseRetention = {
  days: [
    { date: "2026-08-25", users: 5, returned1d: 2, returned7d: 1, rate1d: 0.4, rate7d: 0.2 },
    { date: "2026-08-26", users: 8, returned1d: 3, returned7d: 0, rate1d: 0.375, rate7d: 0 },
  ],
};

const baseDashboard = {
  hasEvents: true,
  health: {
    status: "healthy",
    availability: 0.9982,
    availabilityDelta: 0.09,
    avgLatencyMs: 318,
    latencyDelta: -8.1,
    errorRate: 0.005,
    errorRateDelta: -6.2,
  },
  kpis: {
    users: 38420,
    sessions: 72610,
    actions: 512840,
    apiRequests: 846290,
    errors: 4218,
    usersDelta: 14.8,
    sessionsDelta: 11.3,
    actionsDelta: 17.1,
    apisDelta: 15.6,
    errorsDelta: -6.2,
  },
  activity: [{ label: "2026-08-25", count: 1000 }],
  activityUnit: "day",
  topProblems: [],
  funnel: [],
} as unknown as Parameters<typeof renderMonitorReportPdf>[0]["dashboard"];

const baseProblems = {
  summary: {
    totalErrors: 4218,
    totalErrorsDelta: -6.2,
    usersAffected: 1824,
    usersAffectedDelta: 4.2,
    errors5xx: 1182,
    errors5xxDelta: 8.1,
    critical: 3,
    usersInRange: 5000,
  },
  priority: { critical: 3, high: 8, medium: 14, low: 22 },
  errors: [
    {
      method: "GET",
      path: "/api/tickets",
      statusCode: 500,
      failureReason: "Internal Server Error",
      occurrences: 642,
      usersAffected: 1824,
      sessionsAffected: 2316,
      firstSeen: "2026-08-01T00:00:00.000Z",
      lastSeen: "2026-08-31T23:41:00.000Z",
      avgLatencyMs: 1823,
      errorRate: 0.0184,
      severity: "critical",
      impact: { score: 90, label: "HIGH" },
    },
  ],
  slow: [{ severity: "low", method: "GET", path: "/api/tickets", occurrences: 96820, avgLatencyMs: 812, p95Ms: 2310, lastSeen: "2026-08-31T23:41:00.000Z" }],
} as unknown as Parameters<typeof renderMonitorReportPdf>[0]["problems"];

const basePerformance = {
  kpis: {
    avgLatencyMs: 318,
    avgDelta: -8.1,
    p95Ms: 1420,
    p95Delta: 3.2,
    p99Ms: 2840,
    p99Delta: 1.1,
    slowApis: 17,
    slowDelta: -2.4,
  },
  latency: [
    { label: "Aug 25", avgMs: 300 },
    { label: "Aug 26", avgMs: 340 },
  ],
  latencyUnit: "day",
  endpoints: [
    { method: "GET", path: "/api/tickets", total: 96820, avgLatencyMs: 812, p95Ms: 2310, p99Ms: 2840, maxLatencyMs: 4200 },
  ],
} as unknown as Parameters<typeof renderMonitorReportPdf>[0]["performance"];

const baseBehavior = {
  screens: [
    { screen: "/dashboard", views: 6281, users: 4420 },
    { screen: "/events", views: 4920, users: 3740 },
  ],
  journeys: [{ path: ["/dashboard", "/events", "/tickets"], count: 120, pct: 0.342 }],
  sessionsSampled: 350,
} as unknown as Parameters<typeof renderMonitorReportPdf>[0]["behavior"];

describe("simple PDF writer", () => {
  it("escapes parentheses and strips non-latin characters", () => {
    assert.equal(pdfString("a(b)c"), "(a\\(b\\)c)");
    assert.equal(pdfSafe("café — “ok”"), "café - \"ok\"");
  });

  it("emits a valid PDF header", () => {
    const doc = new SimplePdf();
    doc.text("Hello", 40, 40, { size: 12 });
    const buf = doc.toBuffer();
    assert.ok(buf.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));
    assert.ok(buf.toString("latin1").includes("%%EOF"));
  });
});

describe("monitor report PDF", () => {
  it("renders every section as its own page when all data and sections are present", () => {
    const buffer = renderMonitorReportPdf({
      projectName: "Irembo",
      generatedAt: new Date("2026-09-01T10:00:00.000Z"),
      overview: baseOverview,
      funnels: baseFunnels,
      retention: baseRetention,
      dashboard: baseDashboard,
      problems: baseProblems,
      performance: basePerformance,
      behavior: baseBehavior,
      recommendations: [{ priority: "P0", title: "GET /api/tickets produces 642 failures.", detail: "1824 users affected." }],
    });
    assert.ok(buffer.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));
    const body = buffer.toString("latin1");
    assert.ok(body.includes("Reports"));
    assert.ok(body.includes("Irembo"));
    // Cover + Executive Summary + Behavior + Journey + Health + Problems + Performance + Recommendations
    assert.ok(body.includes("/Count 8"));
    assert.ok(buffer.length > 2000);
  });

  it("gates pages by the selected sections", () => {
    const buffer = renderMonitorReportPdf({
      projectName: "Irembo",
      overview: baseOverview,
      funnels: baseFunnels,
      retention: baseRetention,
      dashboard: baseDashboard,
      problems: baseProblems,
      performance: basePerformance,
      behavior: baseBehavior,
      recommendations: [{ priority: "P0", title: "x", detail: "y" }],
      sections: new Set(["health"]),
    });
    const body = buffer.toString("latin1");
    // Cover + Executive Summary (always) + System Health only = 3 pages.
    assert.ok(body.includes("/Count 3"));
  });

  it("still produces a PDF when optional data and tables are empty", () => {
    const emptyKpi = kpi(0, [0, 0]);
    const buffer = renderMonitorReportPdf({
      projectName: "Empty App",
      overview: {
        range: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T23:59:59.999Z" },
        previous: { from: "2026-08-31T00:00:00.000Z", to: "2026-08-31T23:59:59.998Z" },
        hasEvents: false,
        kpis: {
          users: emptyKpi,
          sessions: emptyKpi,
          actions: emptyKpi,
          apiRequests: emptyKpi,
          errors: emptyKpi,
          avgLatencyMs: emptyKpi,
          avgDurationMs: emptyKpi,
        },
        daily: [
          {
            date: "2026-09-01",
            users: 0,
            sessions: 0,
            durationMs: 0,
            actions: 0,
            apiRequests: 0,
            errors: 0,
            avgLatencyMs: 0,
          },
        ],
        actionsByType: [],
        topScreens: [],
        topApis: [],
        errorsByType: [],
        topUsers: [],
      },
      funnels: { steps: [], transitions: [], conversion: 0, dropoff: null },
      retention: { days: [{ date: "2026-09-01", users: 0, returned1d: 0, returned7d: 0, rate1d: 0, rate7d: 0 }] },
    });
    assert.ok(buffer.subarray(0, 5).toString("latin1") === "%PDF-");
    // All sections default on: Cover + Executive Summary + Behavior + Journey + Health +
    // Problems + Performance render (the latter two just show "no data" text without their
    // optional inputs). Recommendations is the only page skipped outright when there's
    // nothing to show.
    const body = buffer.toString("latin1");
    assert.ok(body.includes("/Count 7"));
  });
});
