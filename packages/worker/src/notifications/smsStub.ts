import { config } from "../config.js";

export async function sendSms(phoneNumber: string | null | undefined, body: string) {
  if (!phoneNumber) {
    return { code: "skipped", response: { reason: "missing_phone_number" } };
  }
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN || !config.SMS_FROM_NUMBER) {
    return { code: "disabled", response: { reason: "sms_credentials_missing", phoneNumber, body } };
  }
  return { code: "sent", response: { provider: "twilio_stub", phoneNumber, body } };
}
