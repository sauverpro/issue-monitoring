import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SentryApiError,
  isTransientSentryError,
  isTransientSentryStatus,
  summarizeSentryBody,
} from "../src/services/sentry/sentryErrors.js";

describe("summarizeSentryBody", () => {
  it("extracts apigateway timeout JSON", () => {
    assert.equal(
      summarizeSentryBody('{"error":"apigateway","detail":"Downstream timeout"}'),
      "apigateway: Downstream timeout"
    );
  });

  it("hides HTML error pages", () => {
    assert.equal(
      summarizeSentryBody("<!doctype html>\n<html lang=\"en\"><title>Server Error | Sentry</title>"),
      "HTML error page (Sentry gateway)"
    );
  });
});

describe("SentryApiError", () => {
  it("does not embed HTML in the message", () => {
    const err = new SentryApiError(504, "<!doctype html><html>boom</html>");
    assert.equal(err.message.includes("<!doctype"), false);
    assert.match(err.message, /504/);
    assert.equal(isTransientSentryStatus(504), true);
    assert.equal(isTransientSentryError(err), true);
  });
});
