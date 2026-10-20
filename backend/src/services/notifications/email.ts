import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../../config.js";

let transporter: Transporter | null = null;

export function emailConfigured(): boolean {
  return Boolean(config.smtp.host);
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

export type EmailAttachment = { filename: string; content: Buffer; contentType?: string };

/** Sends one message; throws on SMTP failure so callers can record the error. */
export async function sendEmail(msg: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
}): Promise<void> {
  if (!emailConfigured()) throw new Error("SMTP is not configured (set SMTP_HOST)");
  await getTransporter().sendMail({
    from: config.smtp.from,
    to: msg.to.join(", "),
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    attachments: msg.attachments,
  });
}
