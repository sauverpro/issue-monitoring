import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapUrlToService,
  mapAppServiceToRollup,
  mapEventToService,
} from "../src/services/sentryServiceMap.js";

describe("mapUrlToService", () => {
  it("maps each tracked API host to its service", () => {
    assert.equal(mapUrlToService("https://openapi.gwiza.tech/wallet/topup"), "MVEND");
    assert.equal(mapUrlToService("https://www.djyh.rw/api/v1/orders"), "KORALINK");
    assert.equal(mapUrlToService("https://core-api.ddin.rw/v1/agency/verify"), "DDIN");
    assert.equal(
      mapUrlToService("https://rw-prod.intelligra.io/intelligrapi/phones"),
      "INTEGRA"
    );
    assert.equal(mapUrlToService("https://resolveit.rw/tickets"), "RESOLVEIT");
  });

  it("matches host without a scheme and ignores www", () => {
    assert.equal(mapUrlToService("djyh.rw/api/v1/health"), "KORALINK");
    assert.equal(mapUrlToService("www.resolveit.rw"), "RESOLVEIT");
  });

  it("returns null for unknown hosts", () => {
    assert.equal(mapUrlToService("https://example.com/x"), null);
    assert.equal(mapUrlToService(""), null);
    assert.equal(mapUrlToService(undefined), null);
  });
});

describe("mapEventToService", () => {
  it("prefers the request URL over the Sentry service tag", () => {
    assert.equal(
      mapEventToService("gwiza", "https://core-api.ddin.rw/v1/agency/verify"),
      "DDIN"
    );
    assert.equal(
      mapEventToService("marketplace", "https://rw-prod.intelligra.io/intelligrapi/x"),
      "INTEGRA"
    );
  });

  it("falls back to the Sentry service tag when the URL is unknown", () => {
    assert.equal(mapEventToService("integra_phones", "/relative/path"), "INTEGRA");
    assert.equal(mapEventToService("tickets", ""), "RESOLVEIT");
    assert.equal(mapEventToService("gwiza", "https://example.com/x"), "MVEND");
    assert.equal(mapAppServiceToRollup("auth"), "KORALINK");
  });
});
