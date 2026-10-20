import { paymentServices } from "../../constants.js";
import { incidentLink } from "./slack.js";
import { emailConfigured, sendEmail } from "./email.js";

/** Recipients for incident emails (ALERT_EMAILS, comma-separated). */
function alertRecipients(): string[] {
  return (process.env.ALERT_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const SEVERITY_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

/**
 * Email only what someone should act on: severities up to ALERT_EMAIL_MAX_SEVERITY
 * (default P2), and every payment-service incident.
 */
export function shouldEmailIncident(service: string, severity: string): boolean {
  if (paymentServices().includes(service.toUpperCase())) return true;
  const max = SEVERITY_RANK[(process.env.ALERT_EMAIL_MAX_SEVERITY ?? "P2").toUpperCase()] ?? 2;
  return (SEVERITY_RANK[severity] ?? 4) <= max;
}

/** Fire-and-forget; never throws. No-op when SMTP or ALERT_EMAILS is unset. */
export async function emailIncidentAlert(
  kind: "opened" | "escalated" | "resolved",
  incident: { id: string; service: string; severity: string; title: string; resolution?: string | null }
): Promise<void> {
  const to = alertRecipients();
  if (!to.length || !emailConfigured() || !shouldEmailIncident(incident.service, incident.severity)) return;
  const verb = kind === "opened" ? "OPENED" : kind === "escalated" ? "ESCALATED" : "RESOLVED";
  const payment = paymentServices().includes(incident.service.toUpperCase());
  try {
    await sendEmail({
      to,
      subject: `[${incident.severity}] ${verb}: ${incident.title}`,
      text: [
        `${incident.service} incident ${verb.toLowerCase()} — ${incident.title}`,
        ...(payment ? ["This is a payment service: agents may be unable to transact."] : []),
        ...(incident.resolution ? [`Resolution: ${incident.resolution}`] : []),
        "",
        incidentLink(incident.id),
      ].join("\n"),
    });
  } catch (err) {
    console.error("[incident-email] send failed", err instanceof Error ? err.message : err);
  }
}
