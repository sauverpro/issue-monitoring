import { z } from "zod";

const MAX_BATCH = 100;

const sessionSchema = z.object({
  id: z.string().min(1).max(128),
  started_at: z.string().optional(),
  user_id: z.string().max(256).optional(),
  email: z.string().max(320).optional(),
  role: z.string().max(64).optional(),
  account_type: z.string().max(64).optional(),
});

const contextSchema = z.object({
  source: z.enum(["mobile", "web"]).optional(),
  platform: z.string().max(64).optional(),
  os: z.string().max(128).optional(),
  app_version: z.string().max(64).optional(),
  network: z.string().max(32).optional(),
  screen: z.string().max(256).optional(),
});

const baseEvent = z.object({
  occurred_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid ISO timestamp"),
  action_index: z.number().int().nonnegative().optional(),
});

const navigationEvent = baseEvent.extend({
  kind: z.literal("navigation"),
  screen: z.string().max(256).optional(),
  from_screen: z.string().max(256).optional(),
  message: z.string().max(512).optional(),
});

const lifecycleEvent = baseEvent.extend({
  kind: z.literal("lifecycle"),
  message: z.string().min(1).max(512),
});

const authEvent = baseEvent.extend({
  kind: z.literal("auth"),
  message: z.string().max(512).optional(),
});

const apiEvent = baseEvent.extend({
  kind: z.literal("api"),
  request_url: z.string().min(1).max(4096),
  http_method: z.string().max(16).optional(),
  status_code: z.number().int().min(0).max(599),
  latency_ms: z.number().int().nonnegative(),
  outcome: z.enum(["SUCCESS", "FAILURE", "OTHER"]).optional(),
  failure_reason: z.string().max(256).optional(),
  request_body: z.unknown().optional(),
  response_body: z.unknown().optional(),
  current_screen: z.string().max(256).optional(),
});

const clickEvent = baseEvent.extend({
  kind: z.literal("click"),
  label: z.string().min(1).max(256),
  target: z.string().max(128).optional(),
  screen: z.string().max(256).optional(),
});

const systemEvent = baseEvent.extend({
  kind: z.literal("system"),
  message: z.string().max(512).optional(),
});

const screenViewEvent = baseEvent.extend({
  kind: z.literal("screen_view"),
  screen: z.string().max(256),
  from_screen: z.string().max(256).optional(),
});

const formStartEvent = baseEvent.extend({
  kind: z.literal("form_start"),
  form: z.string().max(256),
  screen: z.string().max(256).optional(),
});

const formSubmitEvent = baseEvent.extend({
  kind: z.literal("form_submit"),
  form: z.string().max(256),
  screen: z.string().max(256).optional(),
  success: z.boolean().optional(),
});

const searchEvent = baseEvent.extend({
  kind: z.literal("search"),
  query: z.string().max(512),
  screen: z.string().max(256).optional(),
  results_count: z.number().int().nonnegative().optional(),
});

const filterEvent = baseEvent.extend({
  kind: z.literal("filter"),
  filter: z.string().max(256),
  value: z.string().max(256).optional(),
  screen: z.string().max(256).optional(),
});

const modalOpenEvent = baseEvent.extend({
  kind: z.literal("modal_open"),
  modal: z.string().max(256),
  screen: z.string().max(256).optional(),
});

const modalCloseEvent = baseEvent.extend({
  kind: z.literal("modal_close"),
  modal: z.string().max(256),
  screen: z.string().max(256).optional(),
});

const downloadEvent = baseEvent.extend({
  kind: z.literal("download"),
  file: z.string().max(512),
  screen: z.string().max(256).optional(),
});

const fileUploadEvent = baseEvent.extend({
  kind: z.literal("file_upload"),
  file: z.string().max(512),
  screen: z.string().max(256).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
});

const purchaseStartEvent = baseEvent.extend({
  kind: z.literal("purchase_start"),
  item: z.string().max(256).optional(),
  amount: z.number().optional(),
  currency: z.string().max(8).optional(),
  screen: z.string().max(256).optional(),
});

const purchaseCompleteEvent = baseEvent.extend({
  kind: z.literal("purchase_complete"),
  item: z.string().max(256).optional(),
  amount: z.number().optional(),
  currency: z.string().max(8).optional(),
  order_id: z.string().max(256).optional(),
  screen: z.string().max(256).optional(),
});

const logoutEvent = baseEvent.extend({
  kind: z.literal("logout"),
  screen: z.string().max(256).optional(),
});

export const monitorEnvelopeSchema = z.object({
  schema: z.literal("monitor.v1"),
  sent_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Invalid ISO timestamp"),
  session: sessionSchema,
  context: contextSchema.optional(),
  events: z.array(
    z.discriminatedUnion("kind", [
      navigationEvent,
      lifecycleEvent,
      authEvent,
      apiEvent,
      clickEvent,
      systemEvent,
      screenViewEvent,
      formStartEvent,
      formSubmitEvent,
      searchEvent,
      filterEvent,
      modalOpenEvent,
      modalCloseEvent,
      downloadEvent,
      fileUploadEvent,
      purchaseStartEvent,
      purchaseCompleteEvent,
      logoutEvent,
    ])
  ).min(1).max(MAX_BATCH),
});

export type MonitorEnvelope = z.infer<typeof monitorEnvelopeSchema>;
export type MonitorEvent = MonitorEnvelope["events"][number];

export function deriveOutcome(
  statusCode: number,
  explicit?: "SUCCESS" | "FAILURE" | "OTHER"
): "SUCCESS" | "FAILURE" | "OTHER" {
  if (explicit) return explicit;
  if (statusCode === 0) return "OTHER";
  if (statusCode >= 200 && statusCode < 300) return "SUCCESS";
  return "FAILURE";
}
