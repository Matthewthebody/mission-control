import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  approveKnowledgeVersion,
  createKnowledgeSource,
  submitKnowledgeVersionForReview
} from "../src/services/knowledge/knowledgeGovernance.js";
import { processQueuedIngestionJobs, queueIngestionJob } from "../src/services/knowledge/knowledgeIngestion.js";
import { askBailey } from "../src/services/ai/askBailey.js";
import { deterministicLanguageModel } from "../src/services/ai/providers/languageModel.js";
import {
  importManifestEntry,
  planContentImport,
  validateContentManifest,
  type ContentManifest
} from "../src/services/knowledge/contentManifest.js";
import { config } from "../src/config.js";

// Ask Bailey H8 — pilot launch readiness. Proves demo/production separation,
// manifest validation + honest missing-content reporting, and governed import.

const PREFIX = "h8-test-";
let tenantId = "";
let leadershipId = "";

const reviewerAuth = (): AuthUser =>
  ({ id: leadershipId, tenantId, authorityTier: "leadership", department: "executive", roles: ["leadership"], permissions: [], policyGrants: [], jobFunctionProfiles: [], status: "active" }) as unknown as AuthUser;
const tx = <T>(fn: (client: import("pg").PoolClient) => Promise<T>) => withClientTransaction(tenantId, leadershipId, fn);

async function createApprovedSource(title: string, body: string, isDemo: boolean) {
  return tx(async (client) => {
    const created = await createKnowledgeSource(client, reviewerAuth(), {
      title,
      sourceType: "written_sop",
      authorityClass: "approved_sop",
      inlineBody: body,
      isDemo
    });
    await queueIngestionJob(client, tenantId, created.version_id, "document_extract", leadershipId);
    await processQueuedIngestionJobs(client, tenantId, { limit: 10 });
    await submitKnowledgeVersionForReview(client, reviewerAuth(), created.version_id);
    await approveKnowledgeVersion(client, reviewerAuth(), created.version_id, "h8 test");
    return created;
  });
}

beforeAll(async () => {
  const lead = await pool.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  tenantId = lead.rows[0].tenant_id;
  leadershipId = lead.rows[0].id;
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await pool.query(`DELETE FROM knowledge_source WHERE tenant_id = $1 AND title LIKE '${PREFIX}%'`, [tenantId]);
});

describe("H8-A demo/production separation", () => {
  it("in production (demo content disallowed), demo sources are excluded from retrieval while real ones answer", async () => {
    const demoMarker = "DEMOONLYMARKERH8";
    const realMarker = "REALCONTENTMARKERH8";
    await createApprovedSource(`${PREFIX}[DEMO] Widget SOP`, `# Demo\n\nThe demo-only phrase is ${demoMarker} for widget flow.`, true);
    await createApprovedSource(`${PREFIX}Real Widget SOP`, `# Real\n\nThe real phrase is ${realMarker} for widget flow.`, false);

    // Control: with demo allowed (default), the demo source answers.
    let answer = await tx((client) => askBailey(client, reviewerAuth(), { question: "what is the demo-only phrase for widget flow", providerOverride: deterministicLanguageModel }));
    expect(JSON.stringify(answer)).toContain(demoMarker);

    // Flip to production: demo content must vanish from retrieval; real stays.
    // buildVersionEligibilitySql reads the flag at call time.
    const mutable = config as unknown as { ASK_BAILEY_ALLOW_DEMO_CONTENT: boolean };
    const previous = mutable.ASK_BAILEY_ALLOW_DEMO_CONTENT;
    mutable.ASK_BAILEY_ALLOW_DEMO_CONTENT = false;
    try {
      answer = await tx((client) => askBailey(client, reviewerAuth(), { question: "what is the demo-only phrase for widget flow", providerOverride: deterministicLanguageModel }));
      expect(JSON.stringify(answer)).not.toContain(demoMarker);
      const real = await tx((client) => askBailey(client, reviewerAuth(), { question: "what is the real phrase for widget flow", providerOverride: deterministicLanguageModel }));
      expect(JSON.stringify(real)).toContain(realMarker);
    } finally {
      mutable.ASK_BAILEY_ALLOW_DEMO_CONTENT = previous;
    }
  });
});

const sampleManifest: ContentManifest = {
  pilot_name: "Fall Field Coach Pilot",
  environment: "production",
  entries: [
    {
      key: "tether-sop",
      title: `${PREFIX}Tether SOP`,
      source_type: "written_sop",
      authority_class: "approved_sop",
      knowledge_mode: "operational",
      owner_email: "leadership@example.com",
      department_scope: [],
      role_scope: [],
      confidential: false,
      pilot_topics: ["tethered-workflow"],
      inline_body: "# Tether\n\nReseat the cable and restart capture."
    },
    {
      key: "escalation-guide",
      title: `${PREFIX}Escalation Guide`,
      source_type: "escalation_guide",
      authority_class: "approved_sop",
      knowledge_mode: "operational",
      department_scope: [],
      role_scope: [],
      confidential: false,
      pilot_topics: ["escalation"],
      inline_body: null // missing content — a launch blocker, never invented
    }
  ]
};

describe("H8-B manifest validation + governed import", () => {
  it("validates the manifest and reports missing content as a launch blocker (never fabricates)", () => {
    const validation = validateContentManifest(sampleManifest);
    expect(validation.valid).toBe(true);
    expect(validation.ready_entries).toContain("tether-sop");
    expect(validation.missing_content).toContain("escalation-guide");
    const plan = planContentImport(sampleManifest);
    expect(plan.find((p) => p.key === "escalation-guide")?.action).toBe("skip_missing_content");
  });

  it("rejects a structurally invalid manifest", () => {
    const bad = validateContentManifest({ pilot_name: "", environment: "nope", entries: "x" });
    expect(bad.valid).toBe(false);
    expect(bad.schema_errors.length).toBeGreaterThan(0);
  });

  it("imports a ready entry through the governed workflow as production (is_demo=false); skips missing content", async () => {
    const ready = sampleManifest.entries[0];
    const missing = sampleManifest.entries[1];
    const imported = await tx((client) => importManifestEntry(client, reviewerAuth(), sampleManifest, ready, { autoApprove: true }));
    expect(imported.imported).toBe(true);
    const flag = await pool.query<{ is_demo: boolean }>(`SELECT is_demo FROM knowledge_source WHERE tenant_id = $1 AND id = $2`, [tenantId, (imported as { source_id: string }).source_id]);
    expect(flag.rows[0].is_demo).toBe(false);

    const skipped = await tx((client) => importManifestEntry(client, reviewerAuth(), sampleManifest, missing, { autoApprove: true }));
    expect(skipped.imported).toBe(false);
  });
});
