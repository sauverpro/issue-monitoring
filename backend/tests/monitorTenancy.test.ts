import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateApiKey, hashApiKey } from "../src/services/apiKeys.js";
import { canViewKeys, roleAtLeast, slugify } from "../src/services/orgRoles.js";
import {
  classifyNetworkFailure,
  hostAllowed,
  matchUpstreamSlug,
} from "../src/services/monitorHosts.js";
import {
  deriveOutcome,
  monitorEnvelopeSchema,
} from "../src/schemas/monitorIngest.js";

describe("org roles", () => {
  it("ranks owner above viewer", () => {
    assert.equal(roleAtLeast("owner", "admin"), true);
    assert.equal(roleAtLeast("viewer", "admin"), false);
    assert.equal(canViewKeys("admin"), true);
    assert.equal(canViewKeys("member"), false);
  });

  it("slugifies names", () => {
    assert.equal(slugify("ICT Chamber"), "ict-chamber");
    assert.equal(slugify("  "), "project");
  });
});

describe("api keys", () => {
  it("hashes deterministically and prefixes mntr_", () => {
    const a = generateApiKey();
    assert.match(a.raw, /^mntr_/);
    assert.equal(a.hash, hashApiKey(a.raw));
    assert.equal(a.prefix, a.raw.slice(0, 12));
    assert.notEqual(hashApiKey("mntr_aaa"), hashApiKey("mntr_bbb"));
  });
});

describe("host allowlist", () => {
  const hosts = ["openapi.gwiza.tech", "djyh.rw", "core-api.ddin.rw"];

  it("allows tracked hosts including www", () => {
    assert.equal(hostAllowed("https://openapi.gwiza.tech/transfer", hosts), true);
    assert.equal(hostAllowed("https://www.djyh.rw/api/v1/login", hosts), true);
    assert.equal(hostAllowed("https://example.com/x", hosts), false);
  });

  it("maps host to upstream slug", () => {
    const upstreams = [
      { slug: "MVEND", host: "openapi.gwiza.tech" },
      { slug: "KORALINK", host: "djyh.rw" },
    ];
    assert.equal(
      matchUpstreamSlug("https://openapi.gwiza.tech/transfer", upstreams),
      "MVEND"
    );
    assert.equal(matchUpstreamSlug("https://evil.example/x", upstreams), null);
  });
});

describe("ingest envelope", () => {
  it("derives outcomes", () => {
    assert.equal(deriveOutcome(200), "SUCCESS");
    assert.equal(deriveOutcome(401), "FAILURE");
    assert.equal(deriveOutcome(0), "OTHER");
    assert.equal(deriveOutcome(500, "OTHER"), "OTHER");
  });

  it("classifies network failures", () => {
    assert.equal(classifyNetworkFailure("Failed to fetch"), "offline");
    assert.equal(classifyNetworkFailure("ENOTFOUND"), "dns");
    assert.equal(classifyNetworkFailure("request timeout"), "timeout");
  });

  it("accepts a valid monitor.v1 batch", () => {
    const parsed = monitorEnvelopeSchema.safeParse({
      schema: "monitor.v1",
      sent_at: new Date().toISOString(),
      session: { id: "sess-1" },
      context: { source: "mobile", platform: "ios" },
      events: [
        {
          kind: "navigation",
          occurred_at: new Date().toISOString(),
          action_index: 0,
          screen: "/wallet",
        },
        {
          kind: "api",
          occurred_at: new Date().toISOString(),
          action_index: 1,
          request_url: "https://openapi.gwiza.tech/transfer",
          http_method: "POST",
          status_code: 401,
          latency_ms: 654,
          request_body: { amount: 100, pin: "secret" },
          response_body: { error: "insufficient_funds" },
        },
        {
          kind: "click",
          occurred_at: new Date().toISOString(),
          action_index: 2,
          label: "Pay now",
          target: "button",
          screen: "/wallet",
        },
      ],
    });
    assert.equal(parsed.success, true);
  });
});
