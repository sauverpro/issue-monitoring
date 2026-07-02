import type { RequestHandler } from "express";
import { config } from "../config.js";

export const requireIngestKey: RequestHandler = (req, res, next) => {
  const header =
    req.header("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.header("x-api-key");
  if (!header || header !== config.ingestApiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
};
