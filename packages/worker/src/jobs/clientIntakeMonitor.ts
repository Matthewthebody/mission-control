import { config } from "../config.js";

type ClientIntakeSweepResponse = {
  tenant_count: number;
  scanned_mapping_count: number;
  reminder_queued_count: number;
  overdue_queued_count: number;
  suppressed_count: number;
  unmatched_open_count: number;
  failed_count: number;
};

export async function monitorClientIntakeReminders() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/integrations/microsoft/client-intake/internal/reminders/sweep`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
    },
    body: JSON.stringify({
      limit: 250
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Client intake reminder sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as ClientIntakeSweepResponse;
}

type ClientIntakeOperationalControlResponse = {
  tenant_count: number;
  scanned_submission_count: number;
  review_assignment_count: number;
  escalated_count: number;
  digest_queued_count: number;
  suppressed_count: number;
  failed_count: number;
};

export async function monitorClientIntakeOperationalControl() {
  const response = await fetch(
    `http://127.0.0.1:${config.API_PORT}/api/integrations/microsoft/client-intake/internal/operations/sweep`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
      },
      body: JSON.stringify({
        limit: 250
      })
    }
  );

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Client intake operational control sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as ClientIntakeOperationalControlResponse;
}

type SmsReminderSweepResponse = {
  tenant_count: number;
  scanned_mapping_count: number;
  queued_count: number;
  overdue_queued_count: number;
  suppressed_count: number;
  ineligible_count: number;
  failed_count: number;
};

export async function monitorMicrosoft365SmsReminders() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/integrations/microsoft/sms-optimization/internal/reminders/sweep`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
    },
    body: JSON.stringify({
      limit: 250
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Microsoft 365 SMS reminder sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as SmsReminderSweepResponse;
}
