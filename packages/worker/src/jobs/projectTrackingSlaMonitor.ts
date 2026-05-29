import { config } from "../config.js";

type ProjectTrackingSlaSweepResponse = {
  tenant_count: number;
  scanned_step_count: number;
  event_count: number;
  levels: Record<"early_warning" | "risk" | "urgent" | "overdue", number>;
};

export async function monitorProjectTrackingSla() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/workflows/internal/sla/sweep`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
    },
    body: JSON.stringify({
      limit: 500
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Project tracking SLA sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as ProjectTrackingSlaSweepResponse;
}
