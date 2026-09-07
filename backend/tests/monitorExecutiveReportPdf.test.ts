import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderExecutiveReportPdf } from "../src/services/monitorExecutiveReportPdf.js";

function kpi(value: number, previous: number, delta: number | null) {
  return { value, previous, delta, sparkline: [previous, value] };
}

const overview = {
  range: { from: "2026-07-28T00:00:00.000Z", to: "2026-09-04T23:59:59.999Z" },
  previous: { from: "2026-06-21T00:00:00.000Z", to: "2026-07-27T23:59:59.999Z" },
  hasEvents: true,
  kpis: {
    users: kpi(412, 199, 107.0),
    sessions: kpi(1631, 586, 178.3),
    actions: kpi(4734, 1136, 316.7),
    apiRequests: kpi(12798, 6432, 98.9),
    errors: kpi(3811, 596, 539.4),
    avgLatencyMs: kpi(18135, 6776, 167.6),
    avgDurationMs: kpi(227000, 180700, 25.6),
  },
  daily: [
    { date: "2026-09-04", users: 0, sessions: 0, durationMs: 0, actions: 0, apiRequests: 0, errors: 0, avgLatencyMs: 0 },
    { date: "2026-09-03", users: 146, sessions: 530, durationMs: 233000, actions: 1312, apiRequests: 3438, errors: 893, avgLatencyMs: 6731 },
    { date: "2026-09-02", users: 57, sessions: 159, durationMs: 148000, actions: 353, apiRequests: 1202, errors: 309, avgLatencyMs: 10973 },
    { date: "2026-09-01", users: 199, sessions: 729, durationMs: 288000, actions: 3023, apiRequests: 6658, errors: 2274, avgLatencyMs: 5579 },
  ],
  actionsByType: [{ kind: "navigation", count: 2000 }],
  topScreens: [
    { screen: "(unknown)", count: 1130, pct: 0.4 },
    { screen: "Login Screen", count: 400, pct: 0.15 },
  ],
  topApis: [{ method: "GET", path: "/intelligrapi/getcustomertransactions", requests: 823, avgLatencyMs: 22067, errorRate: 0.7 }],
  errorsByType: [
    { type: "other", count: 1691 },
    { type: "network", count: 1238 },
    { type: "4xx", count: 680 },
    { type: "5xx", count: 202 },
  ],
  topUsers: [{ userKey: "u1", userId: "u1", email: "user@example.com", sessions: 12, actions: 184, errors: 2 }],
};

const funnels = {
  steps: [{ screen: "Login Screen", users: 400, conversion: 1 }],
  transitions: [{ from: "Login Screen", to: "/", count: 300 }],
  conversion: 0.2,
  dropoff: null,
};

const retention = {
  days: [
    { date: "2026-09-04", users: 0, returned1d: 0, returned7d: 0, rate1d: 0, rate7d: 0 },
    { date: "2026-09-01", users: 199, returned1d: 19, returned7d: 0, rate1d: 0.1, rate7d: 0 },
  ],
};

const dashboard = {
  health: { availability: 0.7021, availabilityDelta: -14.9, avgLatencyMs: 18135, latencyDelta: 167.6, errorRate: 0.2979, errorRateDelta: 70.5 },
} as any;

const problems = {
  summary: { totalErrors: 3811, totalErrorsDelta: 59.4, usersAffected: 685, usersAffectedDelta: 315.2, errors5xx: 202, errors5xxDelta: 56.6, critical: 0, usersInRange: 412 },
  priority: { critical: 0, high: 30, medium: 31, low: 19 },
  errors: [
    {
      method: "GET",
      path: "/intelligrapi/getcustomertransactions",
      statusCode: 500,
      failureReason: "Internal Server Error",
      occurrences: 578,
      usersAffected: 233,
      sessionsAffected: 360,
      firstSeen: "2026-07-28T00:00:00.000Z",
      lastSeen: "2026-09-04T00:00:00.000Z",
      avgLatencyMs: 22067,
      errorRate: 0.7,
      severity: "high",
      impact: { score: 90, label: "HIGH" },
    },
  ],
  slow: [{ severity: "low", method: "GET", path: "/v1/agency/accounts/all/accounts/info/balance", occurrences: 652, avgLatencyMs: 58737, p95Ms: 21316, lastSeen: "2026-09-04T00:00:00.000Z" }],
} as any;

const performance = {
  kpis: { avgLatencyMs: 18135, avgDelta: 167.6, p95Ms: 11150, p95Delta: 56.1, p99Ms: 56620, p99Delta: 40, slowApis: 40, slowDelta: 10 },
  latency: [{ label: "Sep 1", avgMs: 5579 }],
  latencyUnit: "day",
  endpoints: [
    { method: "GET", path: "/v1/agency/accounts/all/accounts/info/balance", total: 652, avgLatencyMs: 58737, p95Ms: 21316, p99Ms: 740319, maxLatencyMs: 16927983 },
    { method: "GET", path: "/api/v1/vouchers/request", total: 644, avgLatencyMs: 31570, p95Ms: 7268, p99Ms: 58207, maxLatencyMs: 16928197 },
  ],
} as any;

const behavior = {
  screens: [
    { screen: "(unknown)", views: 1130, users: 0 },
    { screen: "Login Screen", views: 400, users: 300 },
    { screen: "/inventory", views: 360, users: 200 },
  ],
  journeys: [{ path: ["Login Screen", "/", "(unknown)"], count: 95, pct: 0.182 }],
  sessionsSampled: 522,
} as any;

describe("monitor executive report PDF", () => {
  it("renders a valid multi-page narrative PDF with the expected section headings", () => {
    const buffer = renderExecutiveReportPdf({
      projectName: "Marketplace",
      overview: overview as any,
      funnels: funnels as any,
      retention: retention as any,
      dashboard,
      problems,
      performance,
      behavior,
    });
    assert.ok(buffer.subarray(0, 8).toString("latin1").startsWith("%PDF-1.4"));
    const body = buffer.toString("latin1");
    assert.ok(body.includes("Executive Summary"));
    assert.ok(body.includes("User Behavior"));
    assert.ok(body.includes("System Health"));
    assert.ok(body.includes("API Performance"));
    assert.ok(body.includes("Recommendations"));
    assert.ok(body.includes("Success Criteria"));
    assert.ok(body.includes("Marketplace"));
    const pageCountMatch = body.match(/\/Count (\d+)/);
    assert.ok(pageCountMatch, "expected a page count in the PDF");
    assert.ok(Number(pageCountMatch![1]) >= 6, "expected the narrative content to span multiple pages");
  });

  it("still produces a valid PDF with mostly-empty data", () => {
    const emptyKpi = { value: 0, previous: 0, delta: null, sparkline: [0, 0] };
    const buffer = renderExecutiveReportPdf({
      projectName: "Empty App",
      overview: {
        range: { from: "2026-09-01T00:00:00.000Z", to: "2026-09-01T23:59:59.999Z" },
        previous: { from: "2026-08-31T00:00:00.000Z", to: "2026-08-31T23:59:59.999Z" },
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
        daily: [{ date: "2026-09-01", users: 0, sessions: 0, durationMs: 0, actions: 0, apiRequests: 0, errors: 0, avgLatencyMs: 0 }],
        actionsByType: [],
        topScreens: [],
        topApis: [],
        errorsByType: [],
        topUsers: [],
      } as any,
      funnels: { steps: [], transitions: [], conversion: 0, dropoff: null } as any,
      retention: { days: [] } as any,
      dashboard: {} as any,
      problems: { summary: { totalErrors: 0, totalErrorsDelta: null, usersAffected: 0, usersAffectedDelta: null, errors5xx: 0, errors5xxDelta: null, critical: 0, usersInRange: 0 }, priority: { critical: 0, high: 0, medium: 0, low: 0 }, errors: [], slow: [] } as any,
      performance: { kpis: { avgLatencyMs: 0, avgDelta: null, p95Ms: 0, p95Delta: null, p99Ms: 0, p99Delta: null, slowApis: 0, slowDelta: null }, latency: [], latencyUnit: "day", endpoints: [] } as any,
      behavior: { screens: [], journeys: [], sessionsSampled: 0 } as any,
    });
    assert.ok(buffer.subarray(0, 5).toString("latin1") === "%PDF-");
  });
});
