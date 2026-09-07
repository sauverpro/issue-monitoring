import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  csvCell,
  enumerateUtcDays,
  pctDelta,
  previousRange,
  retentionFromPairs,
  toCsv,
} from "../src/services/monitorReports.js";

describe("report range helpers", () => {
  it("enumerates inclusive UTC days", () => {
    const days = enumerateUtcDays(
      new Date("2026-08-25T12:00:00.000Z"),
      new Date("2026-09-01T18:00:00.000Z")
    );
    assert.equal(days[0], "2026-08-25");
    assert.equal(days[days.length - 1], "2026-09-01");
    assert.equal(days.length, 8);
  });

  it("builds an equal-length previous window", () => {
    const prev = previousRange({
      from: new Date("2026-08-25T00:00:00.000Z"),
      to: new Date("2026-09-01T23:59:59.999Z"),
    });
    assert.ok(prev.to.getTime() < new Date("2026-08-25T00:00:00.000Z").getTime());
    const cur = new Date("2026-09-01T23:59:59.999Z").getTime() - new Date("2026-08-25T00:00:00.000Z").getTime();
    const p = prev.to.getTime() - prev.from.getTime();
    assert.ok(Math.abs(cur - p) < 2);
  });

  it("computes percent deltas", () => {
    assert.equal(pctDelta(110, 100), 10);
    assert.equal(pctDelta(0, 0), 0);
    assert.equal(pctDelta(5, 0), null);
  });
});

describe("retention", () => {
  it("counts users who return the next day", () => {
    const rows = retentionFromPairs(
      [
        { userKey: "a", date: "2026-08-25" },
        { userKey: "a", date: "2026-08-26" },
        { userKey: "b", date: "2026-08-25" },
      ],
      ["2026-08-25", "2026-08-26"]
    );
    assert.equal(rows[0]!.users, 2);
    assert.equal(rows[0]!.returned1d, 1);
    assert.equal(rows[0]!.rate1d, 0.5);
  });
});

describe("csv", () => {
  it("escapes quotes and commas", () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(toCsv(["a", "b"], [[1, "x"]]), "a,b\n1,x");
  });
});
