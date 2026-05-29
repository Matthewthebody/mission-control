import { config } from "../config.js";

export async function sendEmail(email: string | null | undefined, subject: string, body: string) {
  if (!email) {
    return { code: "skipped", response: { reason: "missing_email" } };
  }
  if (!config.SMTP_FROM_ADDRESS) {
    return { code: "disabled", response: { reason: "smtp_not_configured", email, subject, body } };
  }
  return { code: "sent", response: { provider: "smtp_stub", from: config.SMTP_FROM_ADDRESS, email, subject, body } };
}
