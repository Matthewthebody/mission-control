// Foundation for a future "Ask Mission Control" LLM assistant.
//
// Safety rules baked in here:
// - No API keys ever live in the frontend.
// - No student / client / FERPA-sensitive data is sent to an external model by
//   default. When a backend is configured, the call must run server-side behind
//   the existing API so redaction and auth happen there.
// - Until a secure backend route is configured, this returns a clear
//   "not connected" state instead of pretending to answer.

export type MissionControlAssistantStatus = "answered" | "not_configured" | "error";

export type MissionControlAssistantResult = {
  status: MissionControlAssistantStatus;
  message: string;
};

export const MISSION_CONTROL_ASSISTANT_SUGGESTIONS = [
  "What needs attention today?",
  "Where are staffing gaps?",
  "Which jobs are blocked?",
  "What changed since yesterday?"
] as const;

function readAssistantFlag(): string | undefined {
  try {
    return (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_MISSION_CONTROL_ASSISTANT;
  } catch {
    return undefined;
  }
}

export function isMissionControlAssistantConfigured(): boolean {
  // The assistant only activates when a secure backend route is wired up.
  return readAssistantFlag() === "enabled";
}

export async function askMissionControl(_token: string, question: string): Promise<MissionControlAssistantResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    return { status: "error", message: "Type a question first." };
  }

  if (!isMissionControlAssistantConfigured()) {
    return {
      status: "not_configured",
      message:
        "The Mission Control Assistant isn't connected yet. Once a secure backend is configured it will answer from live operations — and no student or client data leaves the studio by default."
    };
  }

  // Placeholder for the future secure, server-side call (e.g. POST /api/assistant/ask
  // behind the existing API auth). Intentionally left unimplemented so no keys or
  // sensitive data ever live in frontend code.
  return {
    status: "not_configured",
    message: "The Mission Control Assistant backend flag is on, but the secure answer route isn't implemented in this build yet."
  };
}
