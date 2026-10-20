import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { thresholdsFor, paymentServices } from "../src/constants.js";
import { errorRateToDisplayStatus } from "../src/services/slidingWindow.js";
import { percentile, summarizeIncidents } from "../src/services/reliability.js";
import { shouldEmailIncident } from "../src/services/notifications/incidentEmail.js";

const ENV_KEYS = ["PAYMENT_SERVICES", "PAYMENT_DEGRADED_RATE", "PAYMENT_DOWN_RATE", "ALERT_EMAIL_MAX_SEVERITY"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("payment thresholds", () => {
  it("treats MVEND as a payment service by default", () => {
    delete process.env.PAYMENT_SERVICES;
    assert.deepEqual(paymentServices(), ["MVEND"]);
    assert.deepEqual(thresholdsFor("MVEND"), { degraded: 0.02, down: 0.4 });
    assert.deepEqual(thresholdsFor("mvend"), { degraded: 0.02, down: 0.4 });
  });

  it("keeps the default thresholds for other services", () => {
    assert.deepEqual(thresholdsFor("KORALINK"), { degraded: 0.05, down: 0.6 });
    assert.deepEqual(thresholdsFor(undefined), { degraded: 0.05, down: 0.6 });
  });

  it("degrades payments at 3% while other services stay operational", () => {
    assert.equal(errorRateToDisplayStatus(0.03, "MVEND"), "degraded");
    assert.equal(errorRateToDisplayStatus(0.03, "KORALINK"), "operational");
    assert.equal(errorRateToDisplayStatus(0.03), "operational");
    assert.equal(errorRateToDisplayStatus(0.45, "MVEND"), "down");
    assert.equal(errorRateToDisplayStatus(0.45, "KORALINK"), "degraded");
  });

  it("honours env overrides and ignores invalid values", () => {
    process.env.PAYMENT_SERVICES = "MVEND, MOMO";
    process.env.PAYMENT_DEGRADED_RATE = "0.01";
    process.env.PAYMENT_DOWN_RATE = "nope";
    assert.deepEqual(thresholdsFor("MOMO"), { degraded: 0.01, down: 0.4 });
  });
});

describe("percentile", () => {
  it("uses nearest-rank on sorted input", () => {
    assert.equal(percentile([], 0.5), null);
    assert.equal(percentile([5], 0.9), 5);
    assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9), 9);
  });
});

describe("summarizeIncidents", () => {
  const range = { from: new Date("2026-09-01T00:00:00Z"), to: new Date("2026-09-30T23:59:59Z") };
  const at = (s: string) => new Date(s);

  it("computes resolution times, downtime and severity counts", () => {
    const s = summarizeIncidents(
      [
        { severity: "P1", status: "resolved", openedAt: at("2026-09-10T10:00:00Z"), resolvedAt: at("2026-09-10T10:10:00Z"), autoResolved: true },
        { severity: "P3", status: "resolved", openedAt: at("2026-09-11T10:00:00Z"), resolvedAt: at("2026-09-11T10:30:00Z"), autoResolved: false },
        { severity: "P1", status: "resolved", openedAt: at("2026-09-12T10:00:00Z"), resolvedAt: at("2026-09-12T11:00:00Z"), autoResolved: true },
      ],
      range
    );
    assert.equal(s.total, 3);
    assert.deepEqual(s.bySeverity, { P1: 2, P3: 1 });
    assert.equal(s.meanResolutionMinutes, (10 + 30 + 60) / 3);
    assert.equal(s.medianResolutionMinutes, 30);
    assert.equal(s.downtimeMinutes, 100);
    assert.equal(s.longestMinutes, 60);
    assert.equal(s.autoResolvedShare, 2 / 3);
    assert.equal(s.manuallyResolved, 1);
    assert.equal(s.openNow, 0);
  });

  it("clamps downtime to the window and counts open incidents until now", () => {
    const now = at("2026-09-30T12:00:00Z");
    const s = summarizeIncidents(
      [
        // Started before the window: only the in-window part counts as downtime.
        { severity: "P2", status: "resolved", openedAt: at("2026-08-31T23:00:00Z"), resolvedAt: at("2026-09-01T01:00:00Z"), autoResolved: true },
        { severity: "P1", status: "open", openedAt: at("2026-09-30T11:00:00Z"), resolvedAt: null, autoResolved: false },
      ],
      range,
      now
    );
    assert.equal(s.downtimeMinutes, 60 + 60);
    assert.equal(s.openNow, 1);
    // Open incidents have no resolution time yet.
    assert.equal(s.medianResolutionMinutes, 120);
  });

  it("handles no incidents", () => {
    const s = summarizeIncidents([], range);
    assert.equal(s.total, 0);
    assert.equal(s.meanResolutionMinutes, null);
    assert.equal(s.autoResolvedShare, null);
    assert.equal(s.downtimeMinutes, 0);
  });
});

describe("shouldEmailIncident", () => {
  it("emails P1/P2 by default and skips P3/P4", () => {
    delete process.env.ALERT_EMAIL_MAX_SEVERITY;
    assert.equal(shouldEmailIncident("KORALINK", "P1"), true);
    assert.equal(shouldEmailIncident("KORALINK", "P2"), true);
    assert.equal(shouldEmailIncident("KORALINK", "P3"), false);
  });

  it("always emails payment-service incidents", () => {
    assert.equal(shouldEmailIncident("MVEND", "P4"), true);
  });

  it("respects ALERT_EMAIL_MAX_SEVERITY", () => {
    process.env.ALERT_EMAIL_MAX_SEVERITY = "P1";
    assert.equal(shouldEmailIncident("DDIN", "P2"), false);
    process.env.ALERT_EMAIL_MAX_SEVERITY = "P3";
    assert.equal(shouldEmailIncident("DDIN", "P3"), true);
  });
});
