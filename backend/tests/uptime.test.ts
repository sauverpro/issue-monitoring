import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { overlapSecondsInMonth } from "../src/services/uptime.js";

const JAN = new Date(Date.UTC(2026, 0, 1));
const FEB = new Date(Date.UTC(2026, 1, 1));

describe("overlapSecondsInMonth", () => {
  it("returns the full duration for an incident fully inside the month", () => {
    const opened = new Date(Date.UTC(2026, 0, 10, 0, 0, 0));
    const resolved = new Date(Date.UTC(2026, 0, 10, 1, 0, 0));
    assert.equal(overlapSecondsInMonth(opened, resolved, JAN, FEB), 3600);
  });

  it("clamps an incident that spans the month boundary", () => {
    const opened = new Date(Date.UTC(2026, 0, 31, 23, 0, 0));
    const resolved = new Date(Date.UTC(2026, 1, 1, 1, 0, 0));
    // Only the 1 hour before month-end (Jan) counts toward January.
    assert.equal(overlapSecondsInMonth(opened, resolved, JAN, FEB), 3600);
  });

  it("treats a still-open incident as ongoing until the month end", () => {
    const opened = new Date(Date.UTC(2026, 0, 31, 23, 0, 0));
    assert.equal(overlapSecondsInMonth(opened, null, JAN, FEB), 3600);
  });

  it("returns 0 for an incident entirely outside the window", () => {
    const opened = new Date(Date.UTC(2025, 11, 1));
    const resolved = new Date(Date.UTC(2025, 11, 2));
    assert.equal(overlapSecondsInMonth(opened, resolved, JAN, FEB), 0);
  });
});
