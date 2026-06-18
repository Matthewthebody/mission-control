import { config } from "../config.js";

type ExceptionReconcileSweepResponse = {
  tenant_count: number;
  reconciled_tenant_count: number;
  failed_tenant_count: number;
};

// Drives the scheduled reconciliation of the Exception Center / urgent_watch_item
// store. Exception reads are pure by design, so this background sweep is what keeps
// resolved/canceled/deleted-source issues from lingering and reopens returned ones.
export async function monitorExceptionReconcile() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/exceptions/internal/reconcile-sweep`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Exception reconcile sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as ExceptionReconcileSweepResponse;
}
