import { config } from "../../../config.js";
import type { LanguageModelAnswer, LanguageModelProvider, RetrievedSegmentForModel } from "./types.js";

// Language-model providers (architecture record D4).
//
// The deterministic provider is EXTRACTIVE: it composes its answer from the
// retrieved authorized segments and nothing else. That makes it structurally
// immune to prompt injection hidden in source text (content is quoted, never
// executed as instructions), guarantees citations always map to real
// retrieved segments, and lets the whole vertical path run with no external
// dependency, credential, or cost. A hosted provider slots in behind
// ASK_BAILEY_LLM_PROVIDER + BASE_URL/API_KEY/MODEL; until an implementation is
// configured, selection reports an honest `unavailable` state.

const MAX_SEGMENTS_IN_ANSWER = 3;
const MAX_EXCERPT_CHARS = 420;

function trimExcerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MAX_EXCERPT_CHARS) {
    return collapsed;
  }
  const cut = collapsed.slice(0, MAX_EXCERPT_CHARS);
  const lastSentence = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return `${cut.slice(0, lastSentence > 200 ? lastSentence + 1 : MAX_EXCERPT_CHARS).trim()}…`;
}

const AUTHORITY_LABELS: Record<string, string> = {
  official_company_policy: "company policy",
  approved_sop: "the approved SOP",
  approved_training: "the approved training material",
  approved_expert_guidance: "approved expert guidance",
  approved_visual_standard: "the approved visual standard",
  verified_current_workflow: "the verified current workflow",
  future_design_only: "a future-design document"
};

const deterministicLanguageModel: LanguageModelProvider = {
  name: "deterministic",
  async generateAnswer(input): Promise<LanguageModelAnswer> {
    if (input.segments.length === 0) {
      return { status: "failed", reason: "No segments supplied." };
    }
    const chosen = input.segments.slice(0, MAX_SEGMENTS_IN_ANSWER);
    const parts: string[] = [];
    if (input.mode === "planning") {
      parts.push("This is future-design material, not a current operating procedure.");
    }
    for (const segment of chosen) {
      const authority = AUTHORITY_LABELS[segment.authorityClass] ?? "an approved source";
      const locator = segment.locatorLabel ? ` (${segment.locatorLabel})` : "";
      parts.push(`Here's what ${authority} — ${segment.sourceTitle}${locator} — says:\n\n${trimExcerpt(segment.content)}`);
    }
    if (input.segments.length > chosen.length) {
      parts.push(`I found ${input.segments.length - chosen.length} more approved source${input.segments.length - chosen.length === 1 ? "" : "s"} below if you need more depth.`);
    }
    let answer = parts.join("\n\n");
    if (answer.length > input.maxAnswerChars) {
      answer = `${answer.slice(0, input.maxAnswerChars - 1).trimEnd()}…`;
    }
    return {
      status: "ok",
      answerMarkdown: answer,
      usedSegmentIds: chosen.map((segment) => segment.segmentId),
      promptTokens: null,
      completionTokens: null,
      model: "deterministic-extractive-v1"
    };
  }
};

function unavailableLanguageModel(reason: string): LanguageModelProvider {
  return {
    name: "unavailable",
    async generateAnswer(): Promise<LanguageModelAnswer> {
      return { status: "unavailable", reason };
    }
  };
}

export function resolveLanguageModelProvider(): LanguageModelProvider {
  const selected = (config.ASK_BAILEY_LLM_PROVIDER ?? "deterministic").toLowerCase();
  if (selected === "deterministic" || selected === "dev") {
    return deterministicLanguageModel;
  }
  if (selected === "openai_compatible") {
    if (!config.ASK_BAILEY_LLM_BASE_URL || !config.ASK_BAILEY_LLM_API_KEY || !config.ASK_BAILEY_LLM_MODEL) {
      return unavailableLanguageModel(
        "The hosted language-model provider is selected but not configured (ASK_BAILEY_LLM_BASE_URL / ASK_BAILEY_LLM_API_KEY / ASK_BAILEY_LLM_MODEL)."
      );
    }
    // The HTTP implementation is a follow-up slice; selecting it without an
    // implementation must be honest, never faked.
    return unavailableLanguageModel(
      "The openai_compatible provider implementation is not shipped yet — Ask Bailey runs on the deterministic provider until it lands."
    );
  }
  return unavailableLanguageModel(`Unknown ASK_BAILEY_LLM_PROVIDER '${selected}'.`);
}

export { deterministicLanguageModel };
export type { RetrievedSegmentForModel };
