import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nextRunAfter, periodLabel, previousPeriod, scheduleUpsertSchema } from "../src/services/reportSchedules.js";

// Kigali is UTC+2: local midnight = 22:00Z the previous day, 06:00 local = 04:00Z.
const at = (iso: string) => new Date(iso);

describe("previousPeriod", () => {
  it("weekly covers the previous Monday-Sunday in Kigali time", () => {
    // Wednesday 15 Oct 2026, 10:00 local
    const r = previousPeriod("weekly", at("2026-10-15T08:00:00Z"));
    assert.equal(r.from.toISOString(), "2026-10-04T22:00:00.000Z"); // Mon 5 Oct 00:00 local
    assert.equal(r.to.toISOString(), "2026-10-11T21:59:59.999Z"); // Sun 11 Oct 23:59:59.999 local
  });

  it("monthly covers the previous calendar month", () => {
    const r = previousPeriod("monthly", at("2026-10-01T04:00:00Z"));
    assert.equal(r.from.toISOString(), "2026-08-31T22:00:00.000Z");
    assert.equal(r.to.toISOString(), "2026-09-30T21:59:59.999Z");
  });

  it("quarterly covers the previous quarter, across a year boundary", () => {
    const q3 = previousPeriod("quarterly", at("2026-10-16T09:00:00Z"));
    assert.equal(q3.from.toISOString(), "2026-06-30T22:00:00.000Z"); // 1 Jul local
    assert.equal(q3.to.toISOString(), "2026-09-30T21:59:59.999Z");
    const q4 = previousPeriod("quarterly", at("2027-01-05T09:00:00Z"));
    assert.equal(q4.from.toISOString(), "2026-09-30T22:00:00.000Z"); // 1 Oct local
    assert.equal(q4.to.toISOString(), "2026-12-31T21:59:59.999Z");
  });

  it("uses the local date when UTC is still the previous day", () => {
    // 23:30Z on 31 Aug = 01:30 local on 1 Sep, so "previous month" is August.
    const r = previousPeriod("monthly", at("2026-08-31T23:30:00Z"));
    assert.equal(r.from.toISOString(), "2026-07-31T22:00:00.000Z");
  });
});

describe("nextRunAfter", () => {
  it("weekly runs Monday 06:00 local", () => {
    assert.equal(nextRunAfter("weekly", at("2026-10-15T08:00:00Z")).toISOString(), "2026-10-19T04:00:00.000Z");
  });

  it("runs later today when it is the first day before 06:00", () => {
    assert.equal(nextRunAfter("monthly", at("2026-11-01T01:00:00Z")).toISOString(), "2026-11-01T04:00:00.000Z");
  });

  it("is strictly after now", () => {
    assert.equal(nextRunAfter("monthly", at("2026-11-01T04:00:00Z")).toISOString(), "2026-12-01T04:00:00.000Z");
  });

  it("quarterly runs on the first day of the next quarter", () => {
    assert.equal(nextRunAfter("quarterly", at("2026-10-16T09:00:00Z")).toISOString(), "2027-01-01T04:00:00.000Z");
  });
});

describe("periodLabel", () => {
  it("names quarters and months", () => {
    assert.equal(periodLabel("quarterly", previousPeriod("quarterly", at("2026-10-16T09:00:00Z"))), "Q3 2026");
    assert.equal(periodLabel("monthly", previousPeriod("monthly", at("2026-10-16T09:00:00Z"))), "September 2026");
  });
});

describe("scheduleUpsertSchema", () => {
  it("normalizes and de-duplicates recipients", () => {
    const r = scheduleUpsertSchema.parse({ frequency: "weekly", recipients: ["A@x.rw", "a@x.rw ", "b@x.rw"] });
    assert.deepEqual(r.recipients, ["a@x.rw", "b@x.rw"]);
  });

  it("rejects invalid emails", () => {
    assert.ok(!scheduleUpsertSchema.safeParse({ frequency: "weekly", recipients: ["nope"] }).success);
  });
});
