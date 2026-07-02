import { z } from "zod";

const MAX_ENDPOINT_LEN = 2048;
const MAX_REQUEST_URL_LEN = 4096;
const MAX_RESPONSE_BODY_CHARS = 131072; // 128 KiB stored text
const MAX_UPSTREAM_KEY_LEN = 128;

/** Stable id for the integrated API (e.g. `ddin_agency_verify`, `mvend_wallet_topup`). */
const upstreamKeySchema = z
  .string()
  .max(MAX_UPSTREAM_KEY_LEN)
  .transform((s) => s.trim().toLowerCase())
  .refine((s) => s.length >= 1, "upstream_key is required")
  .refine(
    (s) => s.length <= MAX_UPSTREAM_KEY_LEN,
    "upstream_key too long after trim"
  )
  .refine(
    (s) => /^[a-z0-9][a-z0-9_-]*$/.test(s),
    "upstream_key: use lowercase letters, digits, underscore, hyphen (start with alnum)"
  );

const outcomeSchema = z.enum(["SUCCESS", "FAILURE", "OTHER"]);

const baseIngest = z.object({
  service: z.enum(["DDIN", "MVEND"]),
  /** Path or resource id — e.g. `/api/digital-id/verify` */
  endpoint: z.string().min(1).max(MAX_ENDPOINT_LEN),
  /** Full URL called (scheme, host, path, query) — optional */
  request_url: z.string().min(1).max(MAX_REQUEST_URL_LEN).optional(),
  /**
   * HTTP status from the response when available. Use `0` when there is no status line
   * (timeout, DNS failure, connection refused) — stored as OTHER unless `outcome` overrides.
   */
  status_code: z.number().int().min(0).max(599),
  latency_ms: z.number().int().nonnegative(),
  error_code: z.string().optional(),
  source: z.enum(["mobile", "web"]),
  session_id: z.string().optional(),
  occurred_at: z.string().refine(
    (s) => !Number.isNaN(Date.parse(s)),
    "Invalid ISO timestamp"
  ),
  /**
   * Full response payload: JSON string, or any JSON value (object/array/number/boolean)
   * — stored as string (stringified if not already a string). Max ~128 KiB after stringify.
   */
  response_body: z.unknown().optional(),
  upstream_key: upstreamKeySchema,
  /**
   * Explicit call result from the client. If omitted, derived from `status_code`:
   * 0 → OTHER; 2xx → SUCCESS; otherwise FAILURE.
   */
  outcome: outcomeSchema.optional(),
});

function deriveOutcome(
  statusCode: number,
  explicit: z.infer<typeof outcomeSchema> | undefined
): z.infer<typeof outcomeSchema> {
  if (explicit) return explicit;
  if (statusCode === 0) return "OTHER";
  if (statusCode >= 200 && statusCode < 300) return "SUCCESS";
  return "FAILURE";
}

export const ingestEventSchema = baseIngest.transform((data) => {
  let response_body: string | undefined;
  if (data.response_body !== undefined && data.response_body !== null) {
    const raw =
      typeof data.response_body === "string"
        ? data.response_body
        : JSON.stringify(data.response_body);
    response_body = raw.slice(0, MAX_RESPONSE_BODY_CHARS);
  }
  const outcome = deriveOutcome(data.status_code, data.outcome);
  return {
    service: data.service,
    endpoint: data.endpoint,
    request_url: data.request_url,
    status_code: data.status_code,
    latency_ms: data.latency_ms,
    error_code: data.error_code,
    source: data.source,
    session_id: data.session_id,
    occurred_at: data.occurred_at,
    response_body,
    upstream_key: data.upstream_key,
    outcome,
  };
});

export type IngestEventInput = z.infer<typeof ingestEventSchema>;
