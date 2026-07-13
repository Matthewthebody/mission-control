import { apiFetch } from "../api";

// Ask Bailey API service — the read-only assistant endpoints (/api/ask-bailey/*).
// Citations, timestamps, and media links arrive fully assembled from the
// server; this layer never invents or rewrites them.

export type KnowledgeMode = "operational" | "training" | "planning" | "historical";

export type AskBaileyStatus =
  | "supported"
  | "partially_supported"
  | "no_approved_answer"
  | "source_conflict"
  | "provider_unavailable"
  | "access_limited"
  | "error";

export type AskBaileyCitation = {
  segment_id: string;
  source_version_id: string;
  source_id: string;
  title: string;
  source_type: string;
  authority_class: string;
  locator_label: string | null;
  start_seconds: number | null;
  end_seconds: number | null;
  resource_library_item_id: string | null;
  media_url: string | null;
};

export type AskBaileyConflict = {
  conflict_id: string;
  source_a_title: string;
  source_b_title: string;
  owner_a_name: string | null;
  owner_b_name: string | null;
  note: string | null;
};

export type AskBaileyAnswer = {
  status: AskBaileyStatus;
  conversation_id: string;
  message_id: string;
  answer_markdown: string | null;
  citations: AskBaileyCitation[];
  warnings: string[];
  conflicts: AskBaileyConflict[];
  context: { kind: string; id: string; label: string } | null;
  evidence: { source_count: number; highest_authority: string | null; conflict_detected: boolean };
};

export type AskBaileyContext = {
  job_id?: string;
  shoot_id?: string;
  organization_id?: string;
};

export type ConversationSummary = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationMessage = {
  id: string;
  question: string;
  status: AskBaileyStatus;
  answer_markdown: string | null;
  warnings: string[];
  knowledge_mode: KnowledgeMode;
  context_envelope: Record<string, unknown>;
  created_at: string;
};

export type ConversationCitation = AskBaileyCitation & { message_id: string; ordinal: number };

export type ConversationDetail = {
  conversation: { id: string; title: string | null; created_at: string };
  messages: ConversationMessage[];
  citations: ConversationCitation[];
};

export type FeedbackKind = "helpful" | "not_helpful" | "report_incorrect" | "missing_information" | "source_outdated";

export function askBailey(
  token: string,
  input: { question: string; mode?: KnowledgeMode; conversation_id?: string; context?: AskBaileyContext }
) {
  return apiFetch<AskBaileyAnswer>("/api/ask-bailey/ask", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listConversations(token: string) {
  return apiFetch<{ conversations: ConversationSummary[] }>("/api/ask-bailey/conversations", token);
}

export function getConversation(token: string, conversationId: string) {
  return apiFetch<ConversationDetail>(`/api/ask-bailey/conversations/${conversationId}`, token);
}

export function submitAskBaileyFeedback(token: string, messageId: string, kind: FeedbackKind, note?: string) {
  return apiFetch<{ feedback_id: string }>(`/api/ask-bailey/messages/${messageId}/feedback`, token, {
    method: "POST",
    body: JSON.stringify(note ? { kind, note } : { kind })
  });
}

const AUTHORITY_LABELS: Record<string, string> = {
  official_company_policy: "Company policy",
  approved_sop: "Approved SOP",
  approved_training: "Approved training",
  approved_expert_guidance: "Expert guidance",
  approved_visual_standard: "Visual standard",
  verified_current_workflow: "Current workflow",
  future_design_only: "Future design",
  historical_only: "Historical"
};

export function authorityLabel(authorityClass: string): string {
  return AUTHORITY_LABELS[authorityClass] ?? authorityClass.replace(/_/g, " ");
}

export function formatTimestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
