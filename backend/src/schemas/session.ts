import { z } from "zod";

export const sessionIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "sessionId must be alphanumeric (with _ or -)"
  );

export const issueIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^\d+$/, "issueId must be numeric");
