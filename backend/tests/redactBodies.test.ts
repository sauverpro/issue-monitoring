import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clipAndRedactBody, redactValue } from "../src/services/redactBodies.js";

describe("clipAndRedactBody", () => {
  it("redacts password and token keys", () => {
    const out = redactValue({
      amount: 10,
      password: "hunter2",
      nested: { access_token: "abc", ok: true },
    }) as Record<string, unknown>;
    assert.equal(out.amount, 10);
    assert.equal(out.password, "[redacted]");
    const nested = out.nested as Record<string, unknown>;
    assert.equal(nested.access_token, "[redacted]");
    assert.equal(nested.ok, true);
  });

  it("stringifies objects for storage", () => {
    const text = clipAndRedactBody({ pin: "1234", status: "ok" });
    assert.ok(text);
    assert.equal(text!.includes("1234"), false);
    assert.equal(text!.includes("ok"), true);
  });
});
