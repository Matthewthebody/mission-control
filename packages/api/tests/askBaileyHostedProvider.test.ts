import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  isAllowedBaseUrl,
  parseStructuredBlocks,
  resolveLanguageModelProvider
} from "../src/services/ai/providers/languageModel.js";
import type { RetrievedSegmentForModel } from "../src/services/ai/providers/types.js";

// Ask Bailey H2-A — hosted openai_compatible transport, verified against a
// deterministic LOCAL HTTP stub (no live provider, no credentials, no
// dependence on live-provider wording). The stub controls status codes,
// payload shapes, and latency so every branch of the failure matrix is
// exercised for real at the transport boundary.

type StubBehavior = (req: IncomingMessage, body: string, res: ServerResponse) => void;

let server: Server;
let baseUrl = "";
let behavior: StubBehavior = (_req, _body, res) => res.end();
let requestCount = 0;
let lastAuthHeader: string | null = null;
let lastRequestBody = "";

const SEGMENTS: RetrievedSegmentForModel[] = [
  {
    segmentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    sourceTitle: "Stub SOP",
    authorityClass: "approved_sop",
    locatorLabel: "Section: Stub",
    content: "Reseat the stub cable before restarting anything."
  }
];

const GENERATION_INPUT = {
  question: "what do I do with the stub cable?",
  mode: "operational" as const,
  segments: SEGMENTS,
  contextSummary: null,
  maxAnswerChars: 4000
};

const VALID_RESPONSE = {
  id: "req-stub-1",
  choices: [
    {
      message: {
        content: JSON.stringify({
          blocks: [
            {
              kind: "direct_answer",
              text: "Reseat the stub cable first.",
              segment_ids: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]
            }
          ]
        })
      }
    }
  ],
  usage: { prompt_tokens: 120, completion_tokens: 40 }
};

const savedConfig = {
  provider: config.ASK_BAILEY_LLM_PROVIDER,
  baseUrl: config.ASK_BAILEY_LLM_BASE_URL,
  apiKey: config.ASK_BAILEY_LLM_API_KEY,
  model: config.ASK_BAILEY_LLM_MODEL,
  timeout: config.ASK_BAILEY_LLM_TIMEOUT_MS,
  retryMax: config.ASK_BAILEY_LLM_RETRY_MAX,
  killSwitch: config.ASK_BAILEY_LLM_KILL_SWITCH
};

function setHostedConfig(overrides: Partial<Record<string, unknown>> = {}) {
  Object.assign(config, {
    ASK_BAILEY_LLM_PROVIDER: "openai_compatible",
    ASK_BAILEY_LLM_BASE_URL: baseUrl,
    ASK_BAILEY_LLM_API_KEY: "stub-test-key",
    ASK_BAILEY_LLM_MODEL: "stub-model",
    ASK_BAILEY_LLM_TIMEOUT_MS: 1000,
    ASK_BAILEY_LLM_RETRY_MAX: 2,
    ASK_BAILEY_LLM_KILL_SWITCH: false,
    ...overrides
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    requestCount += 1;
    lastAuthHeader = (req.headers.authorization as string | undefined) ?? null;
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      lastRequestBody = body;
      behavior(req, body, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/v1`;
});

afterAll(async () => {
  Object.assign(config, {
    ASK_BAILEY_LLM_PROVIDER: savedConfig.provider,
    ASK_BAILEY_LLM_BASE_URL: savedConfig.baseUrl,
    ASK_BAILEY_LLM_API_KEY: savedConfig.apiKey,
    ASK_BAILEY_LLM_MODEL: savedConfig.model,
    ASK_BAILEY_LLM_TIMEOUT_MS: savedConfig.timeout,
    ASK_BAILEY_LLM_RETRY_MAX: savedConfig.retryMax,
    ASK_BAILEY_LLM_KILL_SWITCH: savedConfig.killSwitch
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  requestCount = 0;
  lastAuthHeader = null;
  lastRequestBody = "";
});

function respondJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

describe("base URL allow-list", () => {
  it("allows https and loopback http only", () => {
    expect(isAllowedBaseUrl("https://api.example.com/v1")).toBe(true);
    expect(isAllowedBaseUrl("http://127.0.0.1:8080/v1")).toBe(true);
    expect(isAllowedBaseUrl("http://localhost:1234")).toBe(true);
    expect(isAllowedBaseUrl("http://internal-service:9000")).toBe(false);
    expect(isAllowedBaseUrl("ftp://example.com")).toBe(false);
    expect(isAllowedBaseUrl("not a url")).toBe(false);
  });
});

describe("structured output schema validation", () => {
  it("accepts only the strict block schema", () => {
    expect(parseStructuredBlocks(JSON.stringify({ blocks: [{ kind: "steps", text: "do x", segment_ids: ["a"] }] }))).toHaveLength(1);
    expect(parseStructuredBlocks("not json")).toBeNull();
    expect(parseStructuredBlocks(JSON.stringify({ blocks: [] }))).toBeNull();
    expect(parseStructuredBlocks(JSON.stringify({ blocks: [{ kind: "poem", text: "x", segment_ids: [] }] }))).toBeNull();
    expect(parseStructuredBlocks(JSON.stringify({ blocks: [{ kind: "steps", text: "", segment_ids: [] }] }))).toBeNull();
    expect(parseStructuredBlocks(JSON.stringify({ answer: "flat prose" }))).toBeNull();
  });
});

describe("hosted transport against the local stub", () => {
  it("returns validated blocks, usage, and the request id on success", async () => {
    setHostedConfig();
    behavior = (_req, _body, res) => respondJson(res, 200, VALID_RESPONSE);
    const result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].segmentIds).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
      expect(result.promptTokens).toBe(120);
      expect(result.completionTokens).toBe(40);
      expect(result.requestId).toBe("req-stub-1");
    }
    // The transport authenticated and carried fenced source data.
    expect(lastAuthHeader).toBe("Bearer stub-test-key");
    expect(lastRequestBody).toContain("<<<DATA");
    expect(lastRequestBody).toContain("QUOTED UNTRUSTED DATA");
  });

  it("retries 429 and transient 5xx within the bounded retry budget", async () => {
    setHostedConfig();
    behavior = (_req, _body, res) => {
      if (requestCount === 1) return respondJson(res, 429, { error: "rate limited" });
      if (requestCount === 2) return respondJson(res, 503, { error: "warming" });
      return respondJson(res, 200, VALID_RESPONSE);
    };
    const result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("ok");
    expect(requestCount).toBe(3);
  });

  it("gives up honestly when retries are exhausted", async () => {
    setHostedConfig({ ASK_BAILEY_LLM_RETRY_MAX: 1 });
    behavior = (_req, _body, res) => respondJson(res, 500, { error: "down" });
    const result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.reason).toContain("500");
    expect(requestCount).toBe(2);
  });

  it("fails honestly on malformed JSON output", async () => {
    setHostedConfig();
    behavior = (_req, _body, res) =>
      respondJson(res, 200, { id: "x", choices: [{ message: { content: "here is prose, not JSON" } }] });
    const result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.reason).toContain("schema validation");
  });

  it("fails honestly on empty output", async () => {
    setHostedConfig();
    behavior = (_req, _body, res) => respondJson(res, 200, { id: "x", choices: [] });
    const result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.reason).toContain("empty");
  });

  it("times out and reports it without retry loops", async () => {
    setHostedConfig({ ASK_BAILEY_LLM_TIMEOUT_MS: 1000 });
    behavior = (_req, _body, res) => setTimeout(() => respondJson(res, 200, VALID_RESPONSE), 3000);
    const result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("failed");
    if (result.status === "failed") expect(result.reason).toContain("timed out");
  });

  it("is honestly unavailable when unconfigured, kill-switched, or misconfigured", async () => {
    setHostedConfig({ ASK_BAILEY_LLM_API_KEY: "" });
    let result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("unavailable");

    setHostedConfig({ ASK_BAILEY_LLM_KILL_SWITCH: true });
    result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toContain("kill switch");

    setHostedConfig({ ASK_BAILEY_LLM_BASE_URL: "http://internal-service:9000" });
    result = await resolveLanguageModelProvider().generateAnswer(GENERATION_INPUT);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.reason).toContain("allowed scheme");
    expect(requestCount).toBe(0);
  });
});
