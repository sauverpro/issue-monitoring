import { Router, type IRouter } from "express";
import { requireJwt } from "../middleware/jwt.js";
import { addSseClient } from "../sse/hub.js";

export function streamRouter(): IRouter {
  const r = Router();
  r.get("/stream", requireJwt, (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    const flush = (res as { flushHeaders?: () => void }).flushHeaders;
    if (typeof flush === "function") flush.call(res);
    res.write("retry: 5000\n\n");
    const remove = addSseClient(res);
    req.on("close", () => {
      remove();
    });
  });
  return r;
}
