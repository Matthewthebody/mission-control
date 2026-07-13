import { config } from "../config.js";

type ProductionBoardSweepResponse = {
  tenant_count: number;
  scanned_job_count: number;
};

// Production-board automation monitor: the sweep used to run as a side effect
// of GET list reads (audit F5) and lost its only invoker when that became
// opt-in. The worker now owns the cadence — same internal-sweep pattern as
// laborMonitor/checklistMonitor.
export async function monitorProductionBoard() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/production-board/internal/sweep`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Production board sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as ProductionBoardSweepResponse;
}
