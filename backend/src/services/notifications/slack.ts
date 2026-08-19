import { config } from "../../config.js";

/** Fire-and-forget Slack incoming-webhook post. No-op if unconfigured; never throws. */
export async function notifySlack(text: string): Promise<void> {
  if (!config.slackWebhookUrl) return;
  try {
    const res = await fetch(config.slackWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error("[slack] webhook responded", res.status, await res.text());
    }
  } catch (e) {
    console.error("[slack] webhook failed", e);
  }
}

export function incidentLink(id: string): string {
  return config.dashboardUrl ? `${config.dashboardUrl}/incidents/${id}` : id;
}
