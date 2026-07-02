import { Router, type IRouter, type Request, type Response } from "express";
import express from "express";
import crypto from "crypto";
import { config } from "../config.js";
import { enqueueSentryPayload } from "../services/eventQueue.js";

function verifySignature(rawBody: Buffer, signature: string | undefined): boolean {
  const secret = config.sentry.webhookSecret;
  if (!secret) return true;
  if (!signature) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest, "utf8"),
      Buffer.from(signature, "utf8")
    );
  } catch {
    return false;
  }
}

export function sentryWebhookRouter(): IRouter {
  const r = Router();

  r.post(
    "/integrations/sentry/webhook",
    express.raw({ type: "application/json", limit: "2mb" }),
    (req: Request, res: Response) => {
      const raw = req.body as Buffer;
      const sig = req.headers["sentry-hook-signature"] as string | undefined;

      if (!verifySignature(raw, sig)) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      let body: unknown;
      try {
        body = JSON.parse(raw.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
      }

      const accepted = enqueueSentryPayload(body);
      res.status(202).json({ accepted });
    }
  );

  return r;
}
