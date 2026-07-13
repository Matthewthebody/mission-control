import { config } from "../config.js";

type KnowledgeIngestionSweepResponse = {
  tenant_count: number;
  processed: number;
};

// Ask Bailey ingestion monitor: drives document extraction and media
// transcription through the API-side sweep so web requests never block on
// long-running ingestion. Same internal-sweep pattern as laborMonitor.
export async function monitorKnowledgeIngestion() {
  const response = await fetch(`http://127.0.0.1:${config.API_PORT}/api/knowledge/internal/ingestion/sweep`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PMC-Internal-Secret": config.INTERNAL_SOCKET_SECRET
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Knowledge ingestion sweep failed (${response.status}): ${message || response.statusText}`);
  }

  return (await response.json()) as KnowledgeIngestionSweepResponse;
}
