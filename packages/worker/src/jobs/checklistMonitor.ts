import { config } from "../config.js";

type ChecklistSweepResponse = {
  tenant_count: number;
  scanned_instance_count: number;
  alert_count: number;
  watch_flag_count: number;
};

export async function monitorChecklistReminders() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/checklists/internal/reminders/sweep`, {
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
    throw new Error(`Checklist reminder sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as ChecklistSweepResponse;
}
