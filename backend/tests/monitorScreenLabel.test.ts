import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveScreenFromMessage,
  isUnknownScreen,
  pickFunnelStart,
} from "../src/services/monitorScreenLabel.js";
import { mergeApiStatsByUpstream } from "../src/services/monitorApiStats.js";

describe("deriveScreenFromMessage", () => {
  it("parses Opened / Viewed / navigation prefixes", () => {
    assert.equal(deriveScreenFromMessage("Opened Login Screen"), "Login Screen");
    assert.equal(deriveScreenFromMessage("Viewed /wallet"), "/wallet");
    assert.equal(deriveScreenFromMessage("Navigation: Home"), "Home");
    assert.equal(deriveScreenFromMessage("Login Screen → /"), "/");
  });

  it("ignores generic kind labels", () => {
    assert.equal(deriveScreenFromMessage("navigation"), undefined);
    assert.equal(deriveScreenFromMessage("screen_view"), undefined);
  });
});

describe("pickFunnelStart", () => {
  it("skips unknown screens", () => {
    const start = pickFunnelStart([
      { screen: "(unknown)", sessions: 100 },
      { screen: "Login Screen", sessions: 80 },
    ]);
    assert.equal(start?.screen, "Login Screen");
  });

  it("detects unknown variants", () => {
    assert.equal(isUnknownScreen("(unknown)"), true);
    assert.equal(isUnknownScreen("unknown"), true);
    assert.equal(isUnknownScreen("/"), false);
  });
});

describe("mergeApiStatsByUpstream", () => {
  it("collapses duplicate service labels for the same host", () => {
    const upstreams = [
      { slug: "KORALINK", host: "djyh.rw" },
      { slug: "MVEND", host: "openapi.gwiza.tech" },
      { slug: "INTEGRA", host: "rw-prod.intelligra.io" },
    ];
    const merged = mergeApiStatsByUpstream(
      [
        {
          service: "KORALINK",
          host: "www.djyh.rw",
          total: 100,
          success: 90,
          failure: 10,
          other: 0,
          avgLatencyMs: 100,
        },
        {
          service: "MVEND",
          host: "www.djyh.rw",
          total: 50,
          success: 0,
          failure: 50,
          other: 0,
          avgLatencyMs: 200,
        },
        {
          service: "MVEND",
          host: "rw-prod.intelligra.io",
          total: 20,
          success: 0,
          failure: 20,
          other: 0,
          avgLatencyMs: 50,
        },
      ],
      upstreams
    );

    const djyh = merged.find((r) => r.host === "djyh.rw");
    assert.ok(djyh);
    assert.equal(djyh!.service, "KORALINK");
    assert.equal(djyh!.total, 150);
    assert.equal(djyh!.success, 90);
    assert.equal(djyh!.failure, 60);

    const integra = merged.find((r) => r.host === "rw-prod.intelligra.io");
    assert.ok(integra);
    assert.equal(integra!.service, "INTEGRA");
  });
});
