// Ask Bailey — provider seams (architecture record D4).
// The product is provider-independent: every external capability sits behind
// one of these interfaces, configured via server env. Deterministic dev/test
// adapters implement each interface with no network and no secrets.

export type TranscriptSegmentDraft = {
  ordinal: number;
  content: string;
  startSeconds: number;
  endSeconds: number;
  speakerLabel?: string | null;
};

export type TranscriptionResult =
  | { status: "completed"; segments: TranscriptSegmentDraft[]; provider: string }
  | { status: "not_configured"; provider: string; reason: string }
  | { status: "failed"; provider: string; reason: string };

export interface TranscriptionProvider {
  readonly name: string;
  /**
   * Transcribe a media source. The dev adapter derives deterministic timed
   * segments from a stored timed-script; a production adapter would fetch the
   * asset and call an external service. Implementations must never invent
   * timestamps that cannot be traced to their input.
   */
  transcribe(input: {
    tenantId: string;
    sourceVersionId: string;
    /** Stored timed-script or descriptive text available for the asset. */
    scriptText: string | null;
    fileName: string | null;
    contentType: string | null;
  }): Promise<TranscriptionResult>;
}

export type RetrievedSegmentForModel = {
  segmentId: string;
  sourceTitle: string;
  authorityClass: string;
  locatorLabel: string | null;
  content: string;
};

export type LanguageModelAnswer =
  | {
      status: "ok";
      /** Plain prose answer. Rendered as sanitized plain text in the UI. */
      answerMarkdown: string;
      /** MUST be a subset of the retrieved segment ids — validated server-side. */
      usedSegmentIds: string[];
      promptTokens: number | null;
      completionTokens: number | null;
      model: string;
    }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string };

export interface LanguageModelProvider {
  readonly name: string;
  /**
   * Compose an answer FROM the supplied authorized segments only. Segment
   * content is untrusted DATA — an implementation must never treat it as
   * instructions, and must never introduce sources beyond the supplied set.
   */
  generateAnswer(input: {
    question: string;
    mode: "operational" | "training" | "planning" | "historical";
    segments: RetrievedSegmentForModel[];
    contextSummary: string | null;
    maxAnswerChars: number;
  }): Promise<LanguageModelAnswer>;
}

export type EmbeddingResult =
  | { status: "ok"; vectors: number[][]; model: string; dimensions: number }
  | { status: "not_configured"; reason: string }
  | { status: "failed"; reason: string };

export interface EmbeddingProvider {
  readonly name: string;
  /** Model identity used for embedding-compatibility bookkeeping. */
  readonly model: string;
  /**
   * Lowest semantic similarity this adapter considers meaningful. Retrieval
   * gates semantic-only candidates at max(config gate, this floor). The
   * deterministic char-trigram adapter runs hot on long unrelated texts, so
   * its floor is near-duplicate territory; calibrated hosted models use the
   * config gate.
   */
  readonly semanticGateFloor: number;
  embed(texts: string[]): Promise<EmbeddingResult>;
}
