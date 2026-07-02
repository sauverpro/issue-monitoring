import { pool } from "../db/pool.js";
import type { PersistEventInput } from "../types/persistEvent.js";
import type { IngestEventInput } from "../schemas/event.js";
import { persistAndProcessEvent } from "./processEvent.js";
import {
  extractSentryRows,
  normalizeSentryRow,
} from "./sentryNormalizer.js";

const queue: PersistEventInput[] = [];
let draining = false;

export function enqueueEvent(payload: IngestEventInput): void {
  queue.push({ ...payload, ingest_source: "direct" });
  void drain();
}

export function enqueuePersistEvent(payload: PersistEventInput): void {
  queue.push(payload);
  void drain();
}

export function enqueueSentryPayload(body: unknown): number {
  const rows = extractSentryRows(body);
  let accepted = 0;
  for (const row of rows) {
    const normalized = normalizeSentryRow(row);
    if (normalized) {
      queue.push(normalized);
      accepted++;
    }
  }
  if (accepted > 0) void drain();
  return accepted;
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const item = queue.shift()!;
      try {
        await persistAndProcessEvent(pool, item);
      } catch (err) {
        console.error("event processing failed", err);
      }
    }
  } finally {
    draining = false;
  }
}
