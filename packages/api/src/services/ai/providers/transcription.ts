import { config } from "../../../config.js";
import type { TranscriptionProvider, TranscriptSegmentDraft, TranscriptionResult } from "./types.js";

// Transcription providers (architecture record D4).
//
// The deterministic dev provider derives timed segments from a STORED
// timed-script attached to the media source — every timestamp traces to stored
// input; nothing is invented and no network is involved. A production provider
// (e.g. a hosted Whisper-compatible service) implements the same interface
// behind ASK_BAILEY_TRANSCRIPTION_PROVIDER; until one is configured, media
// ingestion reports an honest `not_configured` state.

const TIMED_LINE = /^\[(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\]\s*(.+)$/;

export function parseTimedScript(scriptText: string): TranscriptSegmentDraft[] {
  const lines = scriptText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const timed: TranscriptSegmentDraft[] = [];
  const untimed: string[] = [];
  for (const line of lines) {
    const match = TIMED_LINE.exec(line);
    if (match) {
      const start = Number(match[1]) * 60 + Number(match[2]);
      const end = Number(match[3]) * 60 + Number(match[4]);
      if (end >= start && match[5].trim().length > 0) {
        timed.push({
          ordinal: timed.length,
          content: match[5].trim(),
          startSeconds: start,
          endSeconds: end
        });
        continue;
      }
    }
    untimed.push(line);
  }
  if (timed.length > 0) {
    return timed;
  }
  // No explicit timestamps in the script: assign deterministic sequential
  // 30-second windows so ordering and locators stay stable across re-runs.
  return untimed.map((content, index) => ({
    ordinal: index,
    content,
    startSeconds: index * 30,
    endSeconds: index * 30 + 30
  }));
}

const deterministicTranscription: TranscriptionProvider = {
  name: "deterministic",
  async transcribe(input): Promise<TranscriptionResult> {
    if (!input.scriptText || input.scriptText.trim().length === 0) {
      return {
        status: "failed",
        provider: "deterministic",
        reason: "No stored timed-script is attached to this media source — the deterministic provider cannot transcribe raw media."
      };
    }
    const segments = parseTimedScript(input.scriptText);
    return {
      status: "completed",
      provider: "deterministic",
      segments,
      durationSeconds: segments.length > 0 ? Math.max(...segments.map((segment) => segment.endSeconds)) : null
    };
  }
};

// ---------------------------------------------------------------------------
// Real hosted transcription (charter H3-C): Whisper-compatible
// `/audio/transcriptions` transport (OpenAI, Azure OpenAI, self-hosted).
// Uploads the SERVER-fetched media bytes; requests verbose_json with segment
// and word timestamps. Timestamps come only from the provider payload —
// nothing is invented — and the raw payload is preserved for audit.
// ---------------------------------------------------------------------------
type WhisperVerboseJson = {
  duration?: number;
  language?: string;
  segments?: Array<{ id?: number; start?: number; end?: number; text?: string }>;
  words?: Array<{ word?: string; start?: number; end?: number }>;
};

export function parseWhisperVerboseJson(payload: WhisperVerboseJson): {
  segments: TranscriptSegmentDraft[];
  durationSeconds: number | null;
  language: string | null;
} | null {
  if (!Array.isArray(payload.segments) || payload.segments.length === 0) {
    return null;
  }
  const words = Array.isArray(payload.words) ? payload.words : [];
  const segments: TranscriptSegmentDraft[] = [];
  for (const segment of payload.segments) {
    const start = typeof segment.start === "number" ? segment.start : null;
    const end = typeof segment.end === "number" ? segment.end : null;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (start === null || end === null || end < start || text.length === 0) {
      // A segment without provider-supplied timestamps is dropped, never
      // given invented ones.
      continue;
    }
    const segmentWords = words
      .filter(
        (word) =>
          typeof word.start === "number" && typeof word.end === "number" && typeof word.word === "string" &&
          word.start >= start && word.end <= end + 0.01
      )
      .map((word) => ({ word: String(word.word), start: Number(word.start), end: Number(word.end) }));
    segments.push({
      ordinal: segments.length,
      content: text,
      startSeconds: Number(start.toFixed(2)),
      endSeconds: Number(end.toFixed(2)),
      words: segmentWords.length > 0 ? segmentWords : null
    });
  }
  if (segments.length === 0) {
    return null;
  }
  return {
    segments,
    durationSeconds: typeof payload.duration === "number" ? Number(payload.duration.toFixed(2)) : null,
    language: typeof payload.language === "string" ? payload.language : null
  };
}

function openAiCompatibleTranscription(): TranscriptionProvider {
  return {
    name: "openai_compatible",
    async transcribe(input): Promise<TranscriptionResult> {
      const baseUrl = config.ASK_BAILEY_TRANSCRIPTION_BASE_URL;
      const apiKey = config.ASK_BAILEY_TRANSCRIPTION_API_KEY;
      const model = config.ASK_BAILEY_TRANSCRIPTION_MODEL;
      if (!baseUrl || !apiKey || !model) {
        return {
          status: "not_configured",
          provider: "openai_compatible",
          reason:
            "The hosted transcription provider is selected but not configured (ASK_BAILEY_TRANSCRIPTION_BASE_URL / ASK_BAILEY_TRANSCRIPTION_API_KEY / ASK_BAILEY_TRANSCRIPTION_MODEL)."
        };
      }
      if (!input.mediaBytes || input.mediaBytes.length === 0) {
        return {
          status: "failed",
          provider: "openai_compatible",
          reason: "The stored media bytes are unavailable, so there is nothing to transcribe."
        };
      }
      try {
        const form = new FormData();
        form.append(
          "file",
          new Blob([new Uint8Array(input.mediaBytes)], { type: input.contentType ?? "application/octet-stream" }),
          input.fileName ?? "media"
        );
        form.append("model", model);
        form.append("response_format", "verbose_json");
        form.append("timestamp_granularities[]", "segment");
        form.append("timestamp_granularities[]", "word");
        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "api-key": apiKey },
          body: form,
          redirect: "error",
          signal: AbortSignal.timeout(config.ASK_BAILEY_TRANSCRIPTION_TIMEOUT_MS)
        });
        if (!response.ok) {
          return { status: "failed", provider: "openai_compatible", reason: `Transcription provider returned ${response.status}.` };
        }
        const payload = (await response.json().catch(() => null)) as WhisperVerboseJson | null;
        const parsed = payload ? parseWhisperVerboseJson(payload) : null;
        if (!parsed) {
          return {
            status: "failed",
            provider: "openai_compatible",
            reason: "Transcription provider returned a payload without usable timestamped segments."
          };
        }
        return {
          status: "completed",
          provider: "openai_compatible",
          segments: parsed.segments,
          durationSeconds: parsed.durationSeconds,
          language: parsed.language,
          providerRequestId: response.headers.get("x-request-id"),
          rawPayload: payload
        };
      } catch (error) {
        const timedOut = error instanceof Error && error.name === "TimeoutError";
        return {
          status: "failed",
          provider: "openai_compatible",
          reason: timedOut ? "Transcription provider timed out." : "Transcription provider connection failed."
        };
      }
    }
  };
}

export function resolveTranscriptionProvider(): TranscriptionProvider {
  const selected = (config.ASK_BAILEY_TRANSCRIPTION_PROVIDER ?? "deterministic").toLowerCase();
  if (selected === "deterministic" || selected === "dev") {
    return deterministicTranscription;
  }
  if (selected === "openai_compatible") {
    return openAiCompatibleTranscription();
  }
  return {
    name: "none",
    async transcribe(): Promise<TranscriptionResult> {
      return {
        status: "not_configured",
        provider: "none",
        reason: `Unknown ASK_BAILEY_TRANSCRIPTION_PROVIDER '${selected}'.`
      };
    }
  };
}
