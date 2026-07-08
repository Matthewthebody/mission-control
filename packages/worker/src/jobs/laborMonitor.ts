import { config } from "../config.js";

type LaborSweepResponse = {
  tenant_count: number;
  reminder_recipient_count: number;
  overtime_warnings_created: number;
};

// Labor Command Center monitor: triggers the API-side sweep that opens payroll
// self-check windows, sends the 72/48/24/morning-of reminder ladder, and evaluates
// overtime warnings. Same internal-sweep pattern as checklistMonitor.
export async function monitorLabor() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/labor/internal/sweep`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Labor sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as LaborSweepResponse;
}
