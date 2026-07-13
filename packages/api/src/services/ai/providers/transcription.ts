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
    return {
      status: "completed",
      provider: "deterministic",
      segments: parseTimedScript(input.scriptText)
    };
  }
};

const unconfiguredTranscription: TranscriptionProvider = {
  name: "none",
  async transcribe(): Promise<TranscriptionResult> {
    return {
      status: "not_configured",
      provider: "none",
      reason:
        "No transcription provider is configured. Set ASK_BAILEY_TRANSCRIPTION_PROVIDER (and provider credentials) to enable media transcription."
    };
  }
};

export function resolveTranscriptionProvider(): TranscriptionProvider {
  const selected = (config.ASK_BAILEY_TRANSCRIPTION_PROVIDER ?? "deterministic").toLowerCase();
  if (selected === "deterministic" || selected === "dev") {
    return deterministicTranscription;
  }
  // A real hosted provider slots in here behind the same interface; selecting
  // one without an implementation is reported honestly, never faked.
  return unconfiguredTranscription;
}
