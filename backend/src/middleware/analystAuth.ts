import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { JwtPayload } from "./jwt.js";

/**
 * Authentication middleware for Data Analyst & PowerBI Reporting APIs.
 * Supports:
 *  1. Header `Authorization: Bearer <INGEST_API_KEY>` or `Bearer <JWT_TOKEN>`
 *  2. Header `X-API-Key: <INGEST_API_KEY>`
 *  3. Query parameter `?api_key=<INGEST_API_KEY>` or `?token=<JWT_TOKEN>`
 */
export const requireAnalystAuth: RequestHandler = (req, res, next) => {
  const authHeader = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const xApiKey = req.header("x-api-key");
  const queryApiKey = typeof req.query.api_key === "string" ? req.query.api_key : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  const key = authHeader || xApiKey || queryApiKey;
  const token = queryToken || (authHeader && authHeader !== config.ingestApiKey ? authHeader : undefined);

  // 1. Check API Key match
  if (key && key === config.ingestApiKey) {
    next();
    return;
  }

  // 2. Check JWT Token match
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
      req.auth = payload;
      next();
      return;
    } catch {
      /* ignore and drop to 401 */
    }
  }

  res.status(401).json({
    error: "Unauthorized",
    message: "Provide a valid API Key (via X-API-Key, Authorization header, or ?api_key= parameter) or Bearer JWT token.",
  });
};
