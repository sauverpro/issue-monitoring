import { Router, type IRouter } from "express";
import type { Pool } from "pg";
import { requireMonitorIngestKey } from "../middleware/monitorIngestKey.js";
import { monitorEnvelopeSchema } from "../schemas/monitorIngest.js";
import { ingestMonitorEnvelope } from "../services/monitorIngest.js";
import { listProjectUpstreams } from "../services/tenancy.js";
import { config } from "../config.js";

export function monitorIngestRouter(pool: Pool): IRouter {
  const r = Router();
  const auth = requireMonitorIngestKey(pool);

  r.get("/ingest/v1/config", auth, async (req, res) => {
    const project = req.monitorProject!;
    const upstreams = await listProjectUpstreams(pool, project.projectId);
    res.json({
      schema: "monitor.v1",
      ingestUrl: `${config.publicIngestUrl}/ingest/v1`,
      allowedHosts: project.allowedHosts,
      upstreams,
    });
  });

  r.post("/ingest/v1", auth, async (req, res) => {
    const parsed = monitorEnvelopeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await ingestMonitorEnvelope(pool, req.monitorProject!, parsed.data);
      res.status(202).json({ ok: true, ...result });
    } catch (err) {
      console.error("[ingest/v1]", err);
      res.status(500).json({ error: "Ingest failed" });
    }
  });

  return r;
}
