import type { Request, Response, NextFunction } from "express";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 30;

const buckets = new Map<string, { count: number; resetAt: number }>();

export function sentryRateLimit(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const key = req.ip ?? "unknown";
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > MAX_REQUESTS) {
    res.status(429).json({ error: "Too many Sentry proxy requests" });
    return;
  }
  next();
}
