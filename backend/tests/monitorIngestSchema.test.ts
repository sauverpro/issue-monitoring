import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { monitorEnvelopeSchema } from "../src/schemas/monitorIngest.js";

function envelope(events: unknown[]) {
  return {
    schema: "monitor.v1",
    sent_at: "2026-09-01T10:00:00.000Z",
    session: { id: "s1" },
    events,
  };
}

describe("monitorEnvelopeSchema", () => {
  it("accepts the original event kinds", () => {
    const result = monitorEnvelopeSchema.safeParse(
      envelope([{ kind: "click", occurred_at: "2026-09-01T10:00:00.000Z", label: "Buy" }])
    );
    assert.equal(result.success, true);
  });

  it("accepts the new UI/behavior event kinds", () => {
    const events = [
      { kind: "screen_view", occurred_at: "2026-09-01T10:00:00.000Z", screen: "/tickets" },
      { kind: "form_start", occurred_at: "2026-09-01T10:00:01.000Z", form: "checkout" },
      { kind: "form_submit", occurred_at: "2026-09-01T10:00:02.000Z", form: "checkout", success: true },
      { kind: "search", occurred_at: "2026-09-01T10:00:03.000Z", query: "concert", results_count: 4 },
      { kind: "filter", occurred_at: "2026-09-01T10:00:04.000Z", filter: "category", value: "music" },
      { kind: "modal_open", occurred_at: "2026-09-01T10:00:05.000Z", modal: "confirm" },
      { kind: "modal_close", occurred_at: "2026-09-01T10:00:06.000Z", modal: "confirm" },
      { kind: "download", occurred_at: "2026-09-01T10:00:07.000Z", file: "receipt.pdf" },
      { kind: "file_upload", occurred_at: "2026-09-01T10:00:08.000Z", file: "photo.png", size_bytes: 1024 },
      { kind: "purchase_start", occurred_at: "2026-09-01T10:00:09.000Z", item: "Ticket", amount: 10 },
      {
        kind: "purchase_complete",
        occurred_at: "2026-09-01T10:00:10.000Z",
        item: "Ticket",
        amount: 10,
        currency: "USD",
        order_id: "ord_1",
      },
      { kind: "logout", occurred_at: "2026-09-01T10:00:11.000Z" },
    ];
    const result = monitorEnvelopeSchema.safeParse(envelope(events));
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.events.length, events.length);
    }
  });

  it("rejects a screen_view event missing its required screen field", () => {
    const result = monitorEnvelopeSchema.safeParse(
      envelope([{ kind: "screen_view", occurred_at: "2026-09-01T10:00:00.000Z" }])
    );
    assert.equal(result.success, false);
  });

  it("rejects an unknown event kind", () => {
    const result = monitorEnvelopeSchema.safeParse(
      envelope([{ kind: "not_a_real_kind", occurred_at: "2026-09-01T10:00:00.000Z" }])
    );
    assert.equal(result.success, false);
  });
});
