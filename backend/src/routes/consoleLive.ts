import type { IRouter } from "express";
import type { Pool } from "pg";
import jwt from "jsonwebtoken";
import { asyncRouter } from "./asyncRouter.js";
import { config } from "../config.js";
import { requireConsoleJwt } from "../middleware/consoleJwt.js";
import { requireProject } from "../middleware/consoleAuth.js";
import { addLiveClient } from "../sse/liveHub.js";
import { statsFor } from "../services/liveStats.js";
import { ensureSeeded, eventDetail, recentEvents } from "../services/liveFeed.js";
import { listProjectUpstreams } from "../services/tenancy.js";

const TICKET_AUDIENCE = "live-stream";
const TICKET_TTL_SECONDS = 60;

type TicketPayload = { sub: string; pid: string; aud: string };

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function projectSlugs(pool: Pool, projectId: string): Promise<string[]> {
  return [...(await listProjectUpstreams(pool, projectId)).map((u) => u.slug), "CUSTOM"];
}

/**
 * Live dashboard API. Mounted before the other /console routers: they install a
 * blanket header-JWT check, and EventSource cannot send headers, so the stream
 * authenticates with a short-lived ticket instead.
 */
export function consoleLiveRouter(pool: Pool): IRouter {
  const r = asyncRouter();
  const base = "/console/projects/:projectId/live";

  r.post(`${base}/ticket`, requireConsoleJwt, requireProject(pool, "viewer"), (req, res) => {
    const ticket = jwt.sign({ sub: req.consoleAuth!.sub, pid: req.params.projectId }, config.jwtSecret, {
      audience: TICKET_AUDIENCE,
      expiresIn: TICKET_TTL_SECONDS,
    });
    res.json({ ticket, expiresIn: TICKET_TTL_SECONDS });
  });

  r.get(`${base}/stream`, async (req, res) => {
    let payload: TicketPayload;
    try {
      payload = jwt.verify(String(req.query.ticket ?? ""), config.jwtSecret, { audience: TICKET_AUDIENCE }) as TicketPayload;
    } catch {
      res.status(401).json({ error: "Invalid or expired stream ticket" });
      return;
    }
    const projectId = req.params.projectId!;
    if (payload.pid !== projectId) {
      res.status(403).json({ error: "Ticket is for another project" });
      return;
    }
    const [allowed] = await Promise.all([projectSlugs(pool, projectId), ensureSeeded(pool, projectId)]);
    const services = str(req.query.services)?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) ?? null;
    const lastHeader = req.header("last-event-id") ?? str(req.query.since);
    const lastEventId = lastHeader && /^\d+$/.test(lastHeader) ? Number(lastHeader) : null;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write("retry: 3000\n\n");

    const remove = addLiveClient({
      res,
      projectId,
      allowedServices: allowed,
      services,
      userKey: str(req.query.user) ?? null,
      lastEventId,
    });
    // First tick immediately so tiles render without waiting 5 s.
    const snap = statsFor(projectId).snapshot(Date.now(), allowed);
    res.write(`event: tick\ndata: ${JSON.stringify(services ? { ...snap, services: snap.services.filter((s) => services.includes(s.service)) } : snap)}\n\n`);
    req.on("close", remove);
  });

  const viewer = [requireConsoleJwt, requireProject(pool, "viewer")];

  r.get(`${base}/snapshot`, ...viewer, async (req, res) => {
    const projectId = req.params.projectId!;
    const [allowed] = await Promise.all([projectSlugs(pool, projectId), ensureSeeded(pool, projectId)]);
    const stats = statsFor(projectId);
    const now = Date.now();
    res.json({
      snapshot: stats.snapshot(now, allowed),
      agents: stats.agentList(now, 100),
      events: await recentEvents(pool, projectId, {
        service: str(req.query.service),
        failuresOnly: req.query.failures === "1",
        limit: 100,
      }),
    });
  });

  r.get(`${base}/agents`, ...viewer, async (req, res) => {
    const projectId = req.params.projectId!;
    await ensureSeeded(pool, projectId);
    const search = str(req.query.search)?.toLowerCase();
    const list = statsFor(projectId).agentList(Date.now(), 500);
    res.json(search ? list.filter((a) => `${a.email ?? ""} ${a.userId ?? ""} ${a.userKey}`.toLowerCase().includes(search)) : list);
  });

  r.get(`${base}/events`, ...viewer, async (req, res) => {
    const before = str(req.query.before);
    res.json(
      await recentEvents(pool, req.params.projectId!, {
        userKey: str(req.query.user),
        service: str(req.query.service),
        failuresOnly: req.query.failures === "1",
        before: before ? new Date(before) : undefined,
        limit: Number(req.query.limit) || 100,
      })
    );
  });

  r.get(`${base}/events/:eventId`, ...viewer, async (req, res) => {
    const d = await eventDetail(pool, req.params.projectId!, req.params.eventId!);
    if (!d) {
      res.status(404).json({ error: "Event not found" });
      return;
    }
    res.json(d);
  });

  return r;
}
