import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hostAllowed } from "./mapping.js";

describe("host allowlist", () => {
  it("drops unknown hosts", () => {
    assert.equal(hostAllowed("https://openapi.gwiza.tech/x", ["openapi.gwiza.tech"]), true);
    assert.equal(hostAllowed("https://other.example/x", ["openapi.gwiza.tech"]), false);
    assert.equal(hostAllowed("https://openapi.gwiza.tech/x", []), false);
  });
});
