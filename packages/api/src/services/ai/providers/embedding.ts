import { createHash } from "node:crypto";
import { config } from "../../../config.js";
import type { EmbeddingProvider, EmbeddingResult } from "./types.js";

// Embedding providers (charter H1-C).
//
// The deterministic adapter hashes character trigrams of normalized text into
// a fixed-dimension vector. That is a REAL similarity signal for word-form
// variation (inflections, typos, close phrasing share trigrams) and it runs
// with no network, no secrets, and full determinism — but it is not a
// semantic language model. True paraphrase similarity arrives when the
// openai_compatible adapter below is configured with real credentials; both
// sides of the lifecycle (storage, fingerprints, invalidation, retrieval)
// are identical either way.

const DETERMINISTIC_DIMENSIONS = 256;
const DETERMINISTIC_MODEL = "char-trigram-hash-v1";

function normalizeForEmbedding(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function deterministicEmbed(text: string): number[] {
  const normalized = ` ${normalizeForEmbedding(text)} `;
  const vector = new Array<number>(DETERMINISTIC_DIMENSIONS).fill(0);
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    const trigram = normalized.slice(index, index + 3);
    const hash = createHash("sha1").update(trigram).digest();
    const bucket = hash.readUInt16BE(0) % DETERMINISTIC_DIMENSIONS;
    vector[bucket] += 1;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return magnitude === 0 ? vector : vector.map((value) => value / magnitude);
}

const deterministicEmbeddingProvider: EmbeddingProvider = {
  name: "deterministic",
  model: DETERMINISTIC_MODEL,
  // Char-trigram cosines between long unrelated texts commonly reach 0.5-0.65
  // (shared common-English trigrams), so only near-duplicate similarity is
  // meaningful for this adapter.
  semanticGateFloor: 0.75,
  async embed(texts): Promise<EmbeddingResult> {
    return {
      status: "ok",
      vectors: texts.map((text) => deterministicEmbed(text)),
      model: DETERMINISTIC_MODEL,
      dimensions: DETERMINISTIC_DIMENSIONS
    };
  }
};

// Real transport for any OpenAI-compatible embeddings endpoint (Azure OpenAI,
// OpenAI, self-hosted). Credentials come from server env only; ordinary
// automated tests never call this live.
function openAiCompatibleEmbeddingProvider(): EmbeddingProvider {
  const model = config.ASK_BAILEY_EMBEDDING_MODEL;
  return {
    name: "openai_compatible",
    model,
    semanticGateFloor: 0,
    async embed(texts): Promise<EmbeddingResult> {
      if (!config.ASK_BAILEY_EMBEDDING_BASE_URL || !config.ASK_BAILEY_EMBEDDING_API_KEY || !model) {
        return {
          status: "not_configured",
          reason:
            "The hosted embedding provider is selected but not configured (ASK_BAILEY_EMBEDDING_BASE_URL / ASK_BAILEY_EMBEDDING_API_KEY / ASK_BAILEY_EMBEDDING_MODEL)."
        };
      }
      try {
        const response = await fetch(`${config.ASK_BAILEY_EMBEDDING_BASE_URL.replace(/\/$/, "")}/embeddings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.ASK_BAILEY_EMBEDDING_API_KEY}`
          },
          body: JSON.stringify({ model, input: texts }),
          signal: AbortSignal.timeout(20_000)
        });
        if (!response.ok) {
          return { status: "failed", reason: `Embedding provider returned ${response.status}.` };
        }
        const payload = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
        if (!payload.data || payload.data.length !== texts.length) {
          return { status: "failed", reason: "Embedding provider returned an unexpected payload shape." };
        }
        const vectors = [...payload.data].sort((a, b) => a.index - b.index).map((entry) => entry.embedding);
        const dimensions = vectors[0]?.length ?? 0;
        if (dimensions === 0) {
          return { status: "failed", reason: "Embedding provider returned empty vectors." };
        }
        return { status: "ok", vectors, model, dimensions };
      } catch (error) {
        return { status: "failed", reason: error instanceof Error ? error.message : "Embedding request failed." };
      }
    }
  };
}

export function resolveEmbeddingProvider(): EmbeddingProvider {
  const selected = (config.ASK_BAILEY_EMBEDDING_PROVIDER ?? "deterministic").toLowerCase();
  if (selected === "deterministic" || selected === "dev") {
    return deterministicEmbeddingProvider;
  }
  if (selected === "openai_compatible") {
    return openAiCompatibleEmbeddingProvider();
  }
  return {
    name: "unavailable",
    model: "none",
    semanticGateFloor: 1,
    async embed(): Promise<EmbeddingResult> {
      return { status: "not_configured", reason: `Unknown ASK_BAILEY_EMBEDDING_PROVIDER '${selected}'.` };
    }
  };
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    magnitudeA += a[index] * a[index];
    magnitudeB += b[index] * b[index];
  }
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  return dot / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

export { deterministicEmbeddingProvider };
