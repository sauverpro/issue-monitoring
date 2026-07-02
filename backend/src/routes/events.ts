import { Router, type IRouter } from "express";
import { ingestEventSchema } from "../schemas/event.js";
import { requireIngestKey } from "../middleware/ingestKey.js";
import { enqueueEvent } from "../services/eventQueue.js";

export function eventsRouter(): IRouter {
  const r = Router();
  r.post("/events", requireIngestKey, (req, res) => {
    const parsed = ingestEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    enqueueEvent(parsed.data);
    res.status(202).json({ accepted: true });
  });
  return r;
}
