import { createServer, type Server, type ServerResponse } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { createApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import { config } from "../src/config.js";
import type { AuthUser } from "../src/types/auth.js";
import { setStorageReader } from "../src/services/s3.js";
import {
  approveKnowledgeVersion,
  createKnowledgeSource,
  submitKnowledgeVersionForReview
} from "../src/services/knowledge/knowledgeGovernance.js";
import {
  cancelIngestionJob,
  processQueuedIngestionJobs,
  queueIngestionJob
} from "../src/services/knowledge/knowledgeIngestion.js";
import { correctSegment } from "../src/services/knowledge/knowledgeTranscriptReview.js";
import { extractDocumentText } from "../src/services/knowledge/documentExtraction.js";
import { parseWhisperVerboseJson, resolveTranscriptionProvider } from "../src/services/ai/providers/transcription.js";
import { askBailey } from "../src/services/ai/askBailey.js";
import { deterministicLanguageModel } from "../src/services/ai/providers/languageModel.js";

// Ask Bailey H3 — real media ingestion. Contracts under test: file-backed
// extraction is real and verified per format (PDF via pdf-parse with page
// locators, text/markdown), unsupported formats fail honestly, the hosted
// transcription transport works against a local stub (no live provider),
// timestamps never exceed the stored duration, reviewer corrections are
// audited and drive retrieval eligibility, and the protected media route
// enforces the same eligibility predicate as retrieval.

const PREFIX = "km-test-";
const app = createApp();

let tenantId = "";
let leadershipId = "";
let leadershipToken = "";
let associateToken = "";
let pdfBytes: Buffer = Buffer.alloc(0);

const storedObjects = new Map<string, { body: Buffer; contentType: string }>();

const reviewerAuth = (): AuthUser =>
  ({
    id: leadershipId,
    tenantId,
    authorityTier: "leadership",
    department: "executive",
    roles: ["leadership"],
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: []
  }) as unknown as AuthUser;

function buildPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // compress:false — pdfkit's compressed object layout predates the pdf.js
    // build inside pdf-parse; real-world PDFs (Word/Acrobat/print-to-PDF)
    // parse fine. This is a fixture-generation setting only.
    const doc = new PDFDocument({ compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.text("Grayline calibration procedure: warm up the grayline printer for ten minutes before the first proof.");
    doc.addPage();
    doc.text("Grayline escalation: if proofs stay muddy after calibration, notify the production lead.");
    doc.end();
  });
}

async function createFileBackedSource(input: {
  title: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sourceType?: string;
  authorityClass?: string;
  confidential?: boolean;
  scriptText?: string | null;
  jobKind?: "document_extract" | "media_transcribe";
  approve?: boolean;
}) {
  return withClientTransaction(tenantId, leadershipId, async (client) => {
    const item = await client.query<{ id: string }>(
      `INSERT INTO resource_library_item (tenant_id, resource_type, category, file_name, content_type, storage_key, uploader_name, note)
       VALUES ($1, $2, 'sop_reference', $3, $4, $5, 'km test', NULL)
       RETURNING id::text`,
      [tenantId, input.contentType.startsWith("video") || input.contentType.startsWith("audio") ? "video" : "document", input.fileName, input.contentType, input.storageKey]
    );
    const created = await createKnowledgeSource(client, reviewerAuth(), {
      title: input.title,
      sourceType: input.sourceType ?? "written_sop",
      authorityClass: input.authorityClass ?? "approved_sop",
      inlineBody: input.scriptText ?? null,
      confidential: input.confidential,
      resourceLibraryItemId: item.rows[0].id
    });
    const queued = await queueIngestionJob(client, tenantId, created.version_id, input.jobKind ?? "document_extract", leadershipId);
    await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
    if (input.approve !== false) {
      await submitKnowledgeVersionForReview(client, reviewerAuth(), created.version_id);
      await approveKnowledgeVersion(client, reviewerAuth(), created.version_id, "km test");
    }
    return { ...created, job_id: queued.job_id, item_id: item.rows[0].id };
  });
}

beforeAll(async () => {
  const identity = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = identity.rows[0].tenant_id;
  leadershipId = identity.rows[0].id;
  const leadershipLogin = await request(app).post("/auth/dev-login").send({ email: "leadership@example.com" });
  leadershipToken = leadershipLogin.body.token;
  const associateLogin = await request(app).post("/auth/dev-login").send({ email: "associate@example.com" });
  associateToken = associateLogin.body.token;

  pdfBytes = await buildPdf();
  setStorageReader(async (_tenant, key) => {
    const object = storedObjects.get(key);
    if (!object) return { status: "not_found" };
    return { status: "ok", body: object.body, contentType: object.contentType, contentLength: object.body.length };
  });
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
});

afterAll(async () => {
  setStorageReader(null);
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
  await pool.query(`DELETE FROM resource_library_item WHERE tenant_id = $1 AND uploader_name = 'km test'`, [tenantId]);
});

describe("real document extraction (H3-B)", () => {
  it("extracts a real PDF with page locators, idempotently", async () => {
    storedObjects.set("km/grayline.pdf", { body: pdfBytes, contentType: "application/pdf" });
    const source = await createFileBackedSource({
      title: `${PREFIX}Grayline PDF SOP`,
      storageKey: "km/grayline.pdf",
      fileName: "grayline.pdf",
      contentType: "application/pdf"
    });
    const segments = await pool.query(
      `SELECT locator_label, content FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, source.version_id]
    );
    expect(segments.rows.length).toBe(2);
    expect(segments.rows[0].locator_label).toBe("Page 1");
    expect(segments.rows[0].content).toContain("warm up the grayline printer");
    expect(segments.rows[1].locator_label).toBe("Page 2");

    // Retry: re-queue the same job and reprocess — segment count must not grow.
    await pool.query(`UPDATE knowledge_ingestion_job SET status = 'queued' WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      source.job_id
    ]);
    await withClientTransaction(tenantId, leadershipId, (client) => processQueuedIngestionJobs(client, tenantId, { limit: 10 }));
    const after = await pool.query(
      `SELECT count(*)::int AS n FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2`,
      [tenantId, source.version_id]
    );
    expect(after.rows[0].n).toBe(2);
  });

  it("extracts a stored markdown file with section locators", async () => {
    storedObjects.set("km/huddle.md", {
      body: Buffer.from("# Morning Huddle\n\nRun the morning huddle at the equipment table.\n\n# Wrap\n\nConfirm card counts at wrap."),
      contentType: "text/markdown"
    });
    const source = await createFileBackedSource({
      title: `${PREFIX}Huddle MD SOP`,
      storageKey: "km/huddle.md",
      fileName: "huddle.md",
      contentType: "text/markdown"
    });
    const segments = await pool.query(
      `SELECT locator_label FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, source.version_id]
    );
    expect(segments.rows.map((row) => row.locator_label)).toEqual(["Section: Morning Huddle", "Section: Wrap"]);
  });

  it("reports an honest unsupported state for unimplemented formats", async () => {
    storedObjects.set("km/deck.docx", { body: Buffer.from("PKfakezip"), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    const source = await createFileBackedSource({
      title: `${PREFIX}Docx Source`,
      storageKey: "km/deck.docx",
      fileName: "deck.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      approve: false
    });
    const job = await pool.query(`SELECT status, error_message FROM knowledge_ingestion_job WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      source.job_id
    ]);
    expect(job.rows[0].status).toBe("failed");
    expect(job.rows[0].error_message).toMatch(/not supported/i);
  });

  it("unit: extractDocumentText refuses empty and unknown content honestly", async () => {
    expect((await extractDocumentText(Buffer.alloc(0), "text/plain", "x.txt")).status).toBe("failed");
    expect((await extractDocumentText(Buffer.from("binary"), "application/zip", "x.zip")).status).toBe("unsupported");
  });
});

describe("whisper payload parsing (H3-C)", () => {
  it("keeps provider timestamps exactly and attaches word timings", () => {
    const parsed = parseWhisperVerboseJson({
      duration: 12.34,
      language: "english",
      segments: [
        { start: 0.5, end: 4.25, text: " Check the tether. " },
        { start: 4.25, end: 9.1, text: "Then restart the app." },
        { text: "no timestamps — must be dropped" }
      ],
      words: [
        { word: "Check", start: 0.5, end: 1.0 },
        { word: "tether", start: 2.0, end: 2.5 }
      ]
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.segments).toHaveLength(2);
    expect(parsed?.segments[0]).toMatchObject({ startSeconds: 0.5, endSeconds: 4.25, content: "Check the tether." });
    expect(parsed?.segments[0].words).toHaveLength(2);
    expect(parsed?.durationSeconds).toBe(12.34);
  });

  it("returns null rather than inventing anything for unusable payloads", () => {
    expect(parseWhisperVerboseJson({})).toBeNull();
    expect(parseWhisperVerboseJson({ segments: [{ text: "no times" }] })).toBeNull();
  });
});

describe("hosted transcription transport against a local stub (H3-C)", () => {
  let server: Server;
  let baseUrl = "";
  let behavior: (res: ServerResponse) => void = (res) => res.end();
  const saved = {
    provider: config.ASK_BAILEY_TRANSCRIPTION_PROVIDER,
    baseUrl: config.ASK_BAILEY_TRANSCRIPTION_BASE_URL,
    apiKey: config.ASK_BAILEY_TRANSCRIPTION_API_KEY,
    model: config.ASK_BAILEY_TRANSCRIPTION_MODEL,
    timeout: config.ASK_BAILEY_TRANSCRIPTION_TIMEOUT_MS
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      req.resume();
      req.on("end", () => behavior(res));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
    Object.assign(config, {
      ASK_BAILEY_TRANSCRIPTION_PROVIDER: "openai_compatible",
      ASK_BAILEY_TRANSCRIPTION_BASE_URL: baseUrl,
      ASK_BAILEY_TRANSCRIPTION_API_KEY: "stub-key",
      ASK_BAILEY_TRANSCRIPTION_MODEL: "whisper-stub",
      ASK_BAILEY_TRANSCRIPTION_TIMEOUT_MS: 5000
    });
  });

  afterAll(async () => {
    Object.assign(config, {
      ASK_BAILEY_TRANSCRIPTION_PROVIDER: saved.provider,
      ASK_BAILEY_TRANSCRIPTION_BASE_URL: saved.baseUrl,
      ASK_BAILEY_TRANSCRIPTION_API_KEY: saved.apiKey,
      ASK_BAILEY_TRANSCRIPTION_MODEL: saved.model,
      ASK_BAILEY_TRANSCRIPTION_TIMEOUT_MS: saved.timeout
    });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("transcribes stored media bytes and preserves exact provider timestamps + raw payload", async () => {
    behavior = (res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("x-request-id", "tr-req-1");
      res.end(
        JSON.stringify({
          duration: 30.5,
          language: "english",
          segments: [{ start: 6.42, end: 12.0, text: "Reseat the cable at the camera end." }]
        })
      );
    };
    const result = await resolveTranscriptionProvider().transcribe({
      tenantId,
      sourceVersionId: "v",
      scriptText: null,
      mediaBytes: Buffer.from("fake-media-bytes"),
      fileName: "clip.mp4",
      contentType: "video/mp4"
    });
    expect(result.status).toBe("completed");
    if (result.status === "completed") {
      expect(result.segments[0]).toMatchObject({ startSeconds: 6.42, endSeconds: 12 });
      expect(result.durationSeconds).toBe(30.5);
      expect(result.providerRequestId).toBe("tr-req-1");
      expect(result.rawPayload).toBeTruthy();
    }
  });

  it("fails honestly on provider errors and on missing media bytes", async () => {
    behavior = (res) => {
      res.statusCode = 500;
      res.end("{}");
    };
    const failed = await resolveTranscriptionProvider().transcribe({
      tenantId,
      sourceVersionId: "v",
      scriptText: null,
      mediaBytes: Buffer.from("x"),
      fileName: "clip.mp4",
      contentType: "video/mp4"
    });
    expect(failed.status).toBe("failed");

    const noBytes = await resolveTranscriptionProvider().transcribe({
      tenantId,
      sourceVersionId: "v",
      scriptText: null,
      mediaBytes: null,
      fileName: "clip.mp4",
      contentType: "video/mp4"
    });
    expect(noBytes.status).toBe("failed");
    if (noBytes.status === "failed") expect(noBytes.reason).toContain("unavailable");
  });

  it("reports not_configured when credentials are absent", async () => {
    const savedKey = config.ASK_BAILEY_TRANSCRIPTION_API_KEY;
    Object.assign(config, { ASK_BAILEY_TRANSCRIPTION_API_KEY: "" });
    const result = await resolveTranscriptionProvider().transcribe({
      tenantId,
      sourceVersionId: "v",
      scriptText: null,
      mediaBytes: Buffer.from("x"),
      fileName: "clip.mp4",
      contentType: "video/mp4"
    });
    Object.assign(config, { ASK_BAILEY_TRANSCRIPTION_API_KEY: savedKey });
    expect(result.status).toBe("not_configured");
  });
});

describe("transcript review, classification, and duration boundary (H3-D/E)", () => {
  let versionId = "";
  let segmentId = "";

  beforeAll(async () => {
    const source = await createFileBackedSource({
      title: `${PREFIX}Wrap Video`,
      storageKey: "km/wrap.mp4",
      fileName: "wrap.mp4",
      contentType: "video/mp4",
      sourceType: "training_video",
      authorityClass: "approved_training",
      scriptText: "[00:10-00:40] Zebrawrap checklist: count the cards before teardown.\n[00:40-01:20] Zebrawrap escalation: missing card means stop teardown.",
      jobKind: "media_transcribe"
    });
    versionId = source.version_id;
    const segments = await pool.query<{ id: string }>(
      `SELECT id::text FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 ORDER BY ordinal`,
      [tenantId, versionId]
    );
    segmentId = segments.rows[0].id;
  });

  it("stores the media duration and rejects corrections beyond it", async () => {
    const version = await pool.query<{ d: number }>(
      `SELECT media_duration_seconds::float AS d FROM knowledge_source_version WHERE tenant_id = $1 AND id = $2`,
      [tenantId, versionId]
    );
    expect(version.rows[0].d).toBe(80);
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        correctSegment(client, reviewerAuth(), segmentId, { startSeconds: 10, endSeconds: 500, note: "beyond duration" })
      )
    ).rejects.toMatchObject({ status: 400 });
  });

  it("an approved-version correction requires a note, preserves the original, and is audited", async () => {
    await expect(
      withClientTransaction(tenantId, leadershipId, (client) =>
        correctSegment(client, reviewerAuth(), segmentId, { content: "silent change" })
      )
    ).rejects.toMatchObject({ status: 400 });

    const updated = await withClientTransaction(tenantId, leadershipId, (client) =>
      correctSegment(client, reviewerAuth(), segmentId, {
        content: "Zebrawrap checklist: count the cards twice before teardown.",
        note: "provider missed the double count"
      })
    );
    expect(updated.original_content).toContain("count the cards before teardown");
    expect(updated.content).toContain("count the cards twice");
    const audit = await pool.query(
      `SELECT metadata FROM audit_log WHERE tenant_id = $1 AND action = 'knowledge.segment_corrected' AND entity_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, segmentId]
    );
    expect(audit.rows[0].metadata.before.content).toContain("count the cards before");
    expect(audit.rows[0].metadata.after.content).toContain("count the cards twice");
  });

  it("classification drives retrieval eligibility and corrections reach the next answer", async () => {
    const askOnce = () =>
      withClientTransaction(tenantId, leadershipId, (client) =>
        askBailey(client, reviewerAuth(), { question: "zebrawrap card count checklist", providerOverride: deterministicLanguageModel })
      );

    const supported = await askOnce();
    expect(supported.status).toBe("supported");
    expect(supported.answer_markdown).toContain("count the cards twice");

    // Reclassify as raw discussion → the segment must stop answering.
    await withClientTransaction(tenantId, leadershipId, (client) =>
      correctSegment(client, reviewerAuth(), segmentId, { reviewerClassification: "raw_discussion", note: "just chatter" })
    );
    const secondSegment = await pool.query<{ id: string }>(
      `SELECT id::text FROM knowledge_segment WHERE tenant_id = $1 AND source_version_id = $2 AND id <> $3`,
      [tenantId, versionId, segmentId]
    );
    // Only the escalation segment remains eligible.
    const afterReclass = await askOnce();
    const citedIds = afterReclass.citations.map((citation) => citation.segment_id);
    expect(citedIds).not.toContain(segmentId);
    expect(citedIds).toContain(secondSegment.rows[0].id);

    // Restore an eligible classification → it answers again.
    await withClientTransaction(tenantId, leadershipId, (client) =>
      correctSegment(client, reviewerAuth(), segmentId, { reviewerClassification: "approved_instruction", note: "restored" })
    );
    const restored = await askOnce();
    expect(restored.citations.map((citation) => citation.segment_id)).toContain(segmentId);
  });

  it("reviewer-gated review APIs reject non-reviewers and support cancel", async () => {
    const denied = await request(app)
      .get(`/api/knowledge/versions/${versionId}/segments`)
      .set("Authorization", `Bearer ${associateToken}`);
    expect(denied.status).toBe(403);

    const listed = await request(app)
      .get(`/api/knowledge/versions/${versionId}/segments`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.segments.length).toBe(2);
    expect(listed.body.version.media_duration_seconds).toBe(80);

    const queued = await withClientTransaction(tenantId, leadershipId, async (client) => {
      const source = await createKnowledgeSource(client, reviewerAuth(), {
        title: `${PREFIX}Cancel Target`,
        sourceType: "written_sop",
        authorityClass: "approved_sop",
        inlineBody: "# Cancel\n\nCancel me."
      });
      return queueIngestionJob(client, tenantId, source.version_id, "document_extract", leadershipId);
    });
    const canceled = await request(app)
      .post(`/api/knowledge/ingestion-jobs/${queued.job_id}/cancel`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({});
    expect(canceled.status).toBe(200);
    const state = await pool.query(`SELECT status FROM knowledge_ingestion_job WHERE tenant_id = $1 AND id = $2`, [
      tenantId,
      queued.job_id
    ]);
    expect(state.rows[0].status).toBe("canceled");
  });
});

describe("protected media route (H3-A/F)", () => {
  let sourceId = "";
  let confidentialSourceId = "";

  beforeAll(async () => {
    storedObjects.set("km/play.mp4", { body: Buffer.from("FAKE-MEDIA-BYTES-0123456789"), contentType: "video/mp4" });
    const playable = await createFileBackedSource({
      title: `${PREFIX}Playable Video`,
      storageKey: "km/play.mp4",
      fileName: "play.mp4",
      contentType: "video/mp4",
      sourceType: "training_video",
      authorityClass: "approved_training",
      scriptText: "[00:05-00:15] Quokkaplay marker segment.",
      jobKind: "media_transcribe"
    });
    sourceId = playable.source_id;

    storedObjects.set("km/secret.mp4", { body: Buffer.from("SECRET-MEDIA"), contentType: "video/mp4" });
    const confidential = await createFileBackedSource({
      title: `${PREFIX}Confidential Video`,
      storageKey: "km/secret.mp4",
      fileName: "secret.mp4",
      contentType: "video/mp4",
      sourceType: "training_video",
      authorityClass: "approved_training",
      confidential: true,
      scriptText: "[00:05-00:15] Confidential compensation walkthrough.",
      jobKind: "media_transcribe"
    });
    confidentialSourceId = confidential.source_id;
  });

  it("streams bytes with Range support to an eligible user", async () => {
    const full = await request(app)
      .get(`/api/ask-bailey/sources/${sourceId}/media`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(full.status).toBe(200);
    expect(full.headers["content-type"]).toContain("video/mp4");
    expect(full.headers["cache-control"]).toContain("no-store");

    const partial = await request(app)
      .get(`/api/ask-bailey/sources/${sourceId}/media`)
      .set("Authorization", `Bearer ${leadershipToken}`)
      .set("Range", "bytes=0-3");
    expect(partial.status).toBe(206);
    expect(partial.headers["content-range"]).toBe("bytes 0-3/27");
  });

  it("denies unauthenticated and unauthorized access without leaking existence", async () => {
    const anonymous = await request(app).get(`/api/ask-bailey/sources/${sourceId}/media`);
    expect(anonymous.status).toBe(401);

    const associateOnConfidential = await request(app)
      .get(`/api/ask-bailey/sources/${confidentialSourceId}/media`)
      .set("Authorization", `Bearer ${associateToken}`);
    expect(associateOnConfidential.status).toBe(404);

    const leadershipOnConfidential = await request(app)
      .get(`/api/ask-bailey/sources/${confidentialSourceId}/media`)
      .set("Authorization", `Bearer ${leadershipToken}`);
    expect(leadershipOnConfidential.status).toBe(200);
  });

  it("citation media links use the protected route at the exact stored timestamp", async () => {
    const answer = await request(app)
      .post("/api/ask-bailey/ask")
      .set("Authorization", `Bearer ${leadershipToken}`)
      .send({ question: "quokkaplay marker segment" });
    expect(answer.body.status).toBe("supported");
    const citation = answer.body.citations.find((entry: { start_seconds: number | null }) => entry.start_seconds != null);
    expect(citation.media_url).toBe(`/api/ask-bailey/sources/${sourceId}/media#t=5`);
  });
});
