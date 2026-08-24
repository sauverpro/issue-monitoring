import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeHttpSpan,
  normalizeSentryRow,
  deriveSpanOutcome,
  parseHttpDescription,
  clipResponseBody,
} from "../src/services/sentryNormalizer.js";
import {
  applyEnrichment,
  enrichmentFromBreadcrumbs,
  journeyActionsFromBreadcrumbs,
} from "../src/services/sentryBreadcrumbs.js";
import { buildSessionSummary } from "../src/services/sessionSummary.js";
import type { SessionAction } from "../src/types/sessionInvestigation.js";

function apiAction(partial: Partial<SessionAction> & { id: string }): SessionAction {
  return {
    timestamp: "2026-08-19T13:48:00Z",
    message: null,
    type: null,
    status: null,
    actionType: "api_call",
    service: null,
    method: "GET",
    endpoint: null,
    httpStatus: null,
    actionIndex: 0,
    orderId: null,
    failureReason: null,
    role: null,
    accountType: null,
    ...partial,
  };
}

describe("parseHttpDescription", () => {
  it("splits method and URL", () => {
    const p = parseHttpDescription("POST https://openapi.gwiza.tech/transfer");
    assert.equal(p.method, "POST");
    assert.equal(p.url, "https://openapi.gwiza.tech/transfer");
  });
});

describe("normalizeHttpSpan", () => {
  it("maps Gwiza transfer internal_error to MVEND FAILURE with latency", () => {
    const event = normalizeHttpSpan({
      id: "8b85692c1326424cad1cc29245c7f4a2",
      timestamp: "2026-08-19T13:48:22Z",
      "span.op": "http.client",
      "span.description": "POST https://openapi.gwiza.tech/transfer",
      "span.status": "internal_error",
      "span.duration": 653.999805,
      "span.id": "8003c76817444277",
      "http.request.method": "POST",
      "transaction.event_id": "8b85692c1326424cad1cc29245c7f4a2",
      "user.id": "cmpv554xs001kl204zo8vaa0f",
      current_screen: "/wallet",
    });
    assert.ok(event);
    assert.equal(event!.service, "MVEND");
    assert.equal(event!.outcome, "FAILURE");
    assert.equal(event!.latency_ms, 654);
    assert.equal(event!.http_method, "POST");
    assert.equal(event!.current_screen, "/wallet");
    assert.equal(event!.sentry_event_id, "span:8003c76817444277");
    assert.equal(event!.request_url, "https://openapi.gwiza.tech/transfer");
  });

  it("maps FETCH_ERROR on djyh to KORALINK OTHER", () => {
    const event = normalizeSentryRow({
      id: "evt1",
      timestamp: "2026-08-19T13:47:47Z",
      "span.op": "http.client",
      "span.description": "GET https://www.djyh.rw/api/v1/users/me/integration",
      "span.status": "unknown",
      "tags[http_status]": "FETCH_ERROR",
      "http.request.method": "GET",
    });
    assert.ok(event);
    assert.equal(event!.service, "KORALINK");
    assert.equal(event!.outcome, "OTHER");
    assert.equal(event!.status_code, 0);
  });

  it("skips unknown hosts", () => {
    assert.equal(
      normalizeHttpSpan({
        id: "x",
        "span.op": "http.client",
        "span.description": "POST https://example.com/secret",
        "span.status": "ok",
      }),
      null
    );
  });

  it("stores response JSON when present and ignores size-only", () => {
    const withBody = normalizeHttpSpan({
      id: "b1",
      "span.op": "http.client",
      "span.description": "GET https://openapi.gwiza.tech/wallet/10244",
      "span.status": "ok",
      response_body: '{"ok":true}',
    });
    assert.equal(withBody!.outcome, "SUCCESS");
    assert.equal(withBody!.response_body, '{"ok":true}');
    assert.equal(clipResponseBody(undefined), undefined);
  });

  it("prefers tagged api_failure over treating as a span when tags[type] is set", () => {
    const event = normalizeSentryRow({
      id: "tagged",
      timestamp: "2026-08-19T13:48:22Z",
      "tags[type]": "api_failure",
      "tags[status]": "failed",
      "tags[http_status]": "401",
      "tags[endpoint]": "https://openapi.gwiza.tech/transfer",
      "tags[service]": "gwiza",
      "tags[duration_ms]": "609",
      "span.op": "http.client",
    });
    assert.ok(event);
    assert.equal(event!.sentry_event_id, "tagged");
    assert.equal(event!.status_code, 401);
    assert.equal(event!.outcome, "FAILURE");
    assert.equal(event!.latency_ms, 609);
    assert.equal(event!.service, "MVEND");
  });
});

describe("breadcrumb enrichment", () => {
  const event = {
    event_id: "8b85692c",
    breadcrumbs: {
      values: [
        {
          category: "navigation",
          message: "Navigation: / → /wallet",
          timestamp: 1787147274.358,
          data: { fromScreen: "/", toScreen: "/wallet" },
        },
        {
          category: "user",
          message: "App Went to Background",
          timestamp: 1787147299.592,
          data: { session_id: "sess_1787147257968_6coknn" },
        },
        {
          category: "http",
          message: "API POST failed",
          timestamp: 1787147302.035,
          data: {
            duration_ms: 609,
            endpoint: "https://openapi.gwiza.tech/transfer",
            http_status: "401",
            service: "gwiza",
            session_id: "sess_1787147257968_6coknn",
            status: "failed",
          },
        },
      ],
    },
  };

  it("applies 401 and session_id from the HTTP breadcrumb", () => {
    const extra = enrichmentFromBreadcrumbs(
      event,
      "https://openapi.gwiza.tech/transfer"
    );
    assert.equal(extra.http_status, "401");
    assert.equal(extra.session_id, "sess_1787147257968_6coknn");
    assert.equal(extra.duration_ms, 609);

    const base = normalizeHttpSpan({
      id: "span1",
      "span.op": "http.client",
      "span.description": "POST https://openapi.gwiza.tech/transfer",
      "span.status": "internal_error",
      "span.duration": 654,
      "span.id": "8003c76817444277",
    })!;
    const enriched = applyEnrichment(base, extra);
    assert.equal(enriched.status_code, 401);
    assert.equal(enriched.outcome, "FAILURE");
    assert.equal(enriched.session_id, "sess_1787147257968_6coknn");
    assert.equal(enriched.latency_ms, 609);
  });

  it("extracts navigation and lifecycle journey rows", () => {
    const rows = journeyActionsFromBreadcrumbs(event, "sess_x", "8b85692c");
    assert.ok(rows.some((r) => r.kind === "navigation" && r.screen === "/wallet"));
    assert.ok(rows.some((r) => r.kind === "lifecycle"));
  });
});

describe("deriveSpanOutcome", () => {
  it("is FAILURE for internal_error", () => {
    assert.equal(deriveSpanOutcome("internal_error", "", 0, true), "FAILURE");
  });
  it("is OTHER for FETCH_ERROR", () => {
    assert.equal(deriveSpanOutcome("unknown", "FETCH_ERROR", 0, true), "OTHER");
  });
  it("is SUCCESS for ok", () => {
    assert.equal(deriveSpanOutcome("ok", "", 0, true), "SUCCESS");
  });
});

describe("sessionSummary ignores journey rows", () => {
  it("counts only the 401 as a failed API call", () => {
    const actions: SessionAction[] = [
      apiAction({
        id: "nav",
        actionType: "navigation",
        message: "Navigation: / → /wallet",
        screen: "/wallet",
        timestamp: "2026-08-19T13:47:54Z",
      }),
      apiAction({
        id: "bg",
        actionType: "lifecycle",
        message: "App Went to Background",
        timestamp: "2026-08-19T13:48:19Z",
      }),
      apiAction({
        id: "xfer",
        actionType: "api_call",
        method: "POST",
        endpoint: "https://openapi.gwiza.tech/transfer",
        httpStatus: "401",
        status: "failure",
        service: "MVEND",
        timestamp: "2026-08-19T13:48:22Z",
      }),
    ];
    const s = buildSessionSummary(actions);
    assert.equal(s.totalActions, 3);
    assert.equal(s.apiCalls, 1);
    assert.equal(s.failedActions, 1);
    assert.equal(s.successfulActions, 0);
    assert.equal(s.errorRate, 1);
  });
});
