import type { IRouter } from "express";
import { asyncRouter } from "./asyncRouter.js";
import type { Pool } from "pg";
import { requireMonitorIngestKey } from "../middleware/monitorIngestKey.js";
import { monitorEnvelopeSchema } from "../schemas/monitorIngest.js";
import { ingestMonitorEnvelope } from "../services/monitorIngest.js";
import { listProjectUpstreams } from "../services/tenancy.js";
import { config } from "../config.js";
import { resolvePublicOrigin } from "../services/lanHost.js";
import {
  createFeedback,
  feedbackCreateSchema,
  ingestFeedbackSchema,
  ingestReleaseSchema,
  recordCiRelease,
} from "../services/productOps.js";

export function monitorIngestRouter(pool: Pool): IRouter {
  const r = asyncRouter();
  const auth = requireMonitorIngestKey(pool);

  r.get("/ingest/v1/config", auth, async (req, res) => {
    const project = req.monitorProject!;
    const upstreams = await listProjectUpstreams(pool, project.projectId);
    res.json({
      schema: "monitor.v1",
      ingestUrl: `${resolvePublicOrigin(req, config.publicIngestUrl)}/ingest/v1`,
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

  /** In-app feedback from the instrumented app; lands in the project's feedback backlog. */
  r.post("/ingest/v1/feedback", auth, async (req, res) => {
    const parsed = ingestFeedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const f = parsed.data;
    const firstLine = f.message.split(/\r?\n/)[0]!.trim();
    const id = await createFeedback(
      pool,
      req.monitorProject!.projectId,
      feedbackCreateSchema.parse({
        title: f.title || (firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine),
        details: f.screen ? `${f.message}\n\nScreen: ${f.screen}` : f.message,
        source: "in_app",
        category: f.category,
        feature: f.feature ?? "general",
        reporterName: f.session?.name,
        userEmail: f.session?.email,
        userId: f.session?.user_id,
        sessionId: f.session?.id,
      }),
      null
    );
    res.status(201).json({ ok: true, id });
  });

  /** Deploy hook: CI records each shipped version for the patch calendar. */
  r.post("/ingest/v1/releases", auth, async (req, res) => {
    const parsed = ingestReleaseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const out = await recordCiRelease(pool, req.monitorProject!.projectId, parsed.data);
    res.status(out.created ? 201 : 200).json({ ok: true, ...out });
  });

  return r;
}
