import { z } from "zod";
import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { approveKnowledgeVersion, createKnowledgeSource, submitKnowledgeVersionForReview } from "./knowledgeGovernance.js";
import { processQueuedIngestionJobs, queueIngestionJob } from "./knowledgeIngestion.js";

// Ask Bailey H8 — real-content pilot manifest.
//
// A manifest describes the bounded pilot corpus (approved SOPs, videos, guides)
// with every governance field required to bring a source through the SAME
// governed workflow employees see — no back door. The import tool NEVER
// fabricates company policy: an entry without real content (inline_body or a
// resource_library_item_id) is reported as a launch blocker, not invented.

export const manifestEntrySchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  source_type: z.enum([
    "written_sop",
    "policy_document",
    "training_video",
    "training_audio",
    "troubleshooting_guide",
    "checklist",
    "escalation_guide",
    "visual_standard"
  ]),
  authority_class: z.string().min(1),
  knowledge_mode: z.enum(["operational", "training", "planning", "historical"]).default("operational"),
  owner_email: z.string().email().optional(),
  approver_email: z.string().email().optional(),
  department_scope: z.array(z.string()).default([]),
  role_scope: z.array(z.string()).default([]),
  effective_from: z.string().nullable().optional(),
  review_due_at: z.string().nullable().optional(),
  confidential: z.boolean().default(false),
  pilot_topics: z.array(z.string()).default([]),
  // Real content is EITHER an inline body OR a linked Resource Library asset.
  inline_body: z.string().nullable().optional(),
  resource_library_item_id: z.string().uuid().nullable().optional()
});

export const contentManifestSchema = z.object({
  pilot_name: z.string().min(1),
  environment: z.enum(["demo", "production"]),
  generated_by: z.string().optional(),
  entries: z.array(manifestEntrySchema).max(200)
});

export type ContentManifest = z.infer<typeof contentManifestSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export type ManifestValidation = {
  valid: boolean;
  entry_count: number;
  ready_entries: string[];
  missing_content: string[];
  schema_errors: string[];
  coverage_topics: string[];
};

// Structural validation + a real-content readiness check. An entry is "ready"
// only when it carries actual content; otherwise it is a named launch blocker.
export function validateContentManifest(raw: unknown): ManifestValidation {
  const parsed = contentManifestSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      entry_count: 0,
      ready_entries: [],
      missing_content: [],
      schema_errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      coverage_topics: []
    };
  }
  const manifest = parsed.data;
  const ready: string[] = [];
  const missing: string[] = [];
  for (const entry of manifest.entries) {
    const hasContent = Boolean((entry.inline_body && entry.inline_body.trim()) || entry.resource_library_item_id);
    if (hasContent) ready.push(entry.key);
    else missing.push(entry.key);
  }
  const topics = [...new Set(manifest.entries.flatMap((e) => e.pilot_topics))].sort();
  return {
    valid: true,
    entry_count: manifest.entries.length,
    ready_entries: ready,
    missing_content: missing,
    schema_errors: [],
    coverage_topics: topics
  };
}

export type ImportPlanItem = { key: string; action: "import" | "skip_missing_content"; reason?: string };

// Plan without executing — the tool always shows the plan first.
export function planContentImport(manifest: ContentManifest): ImportPlanItem[] {
  return manifest.entries.map((entry) => {
    const hasContent = Boolean((entry.inline_body && entry.inline_body.trim()) || entry.resource_library_item_id);
    return hasContent
      ? { key: entry.key, action: "import" as const }
      : { key: entry.key, action: "skip_missing_content" as const, reason: "No inline_body or resource_library_item_id — real content not provided." };
  });
}

// Import a single ready entry through the governed workflow. Demo/production is
// explicit: an entry in a production manifest is created with is_demo=false.
// Auto-approval is opt-in (real content is normally reviewed by a human); when
// off, the source is left pending_review for the owner to approve.
export async function importManifestEntry(
  client: PoolClient,
  auth: AuthUser,
  manifest: ContentManifest,
  entry: ManifestEntry,
  options: { autoApprove?: boolean } = {}
) {
  const hasContent = Boolean((entry.inline_body && entry.inline_body.trim()) || entry.resource_library_item_id);
  if (!hasContent) {
    return { key: entry.key, imported: false, reason: "missing_content" as const };
  }
  const created = await createKnowledgeSource(client, auth, {
    title: entry.title,
    sourceType: entry.source_type,
    authorityClass: entry.authority_class,
    knowledgeMode: entry.knowledge_mode,
    inlineBody: entry.inline_body ?? null,
    resourceLibraryItemId: entry.resource_library_item_id ?? null,
    departmentScope: entry.department_scope,
    roleScope: entry.role_scope,
    effectiveFrom: entry.effective_from ?? null,
    reviewDueAt: entry.review_due_at ?? null,
    confidential: entry.confidential,
    isDemo: manifest.environment === "demo"
  });
  await queueIngestionJob(client, auth.tenantId, created.version_id, "document_extract", auth.id);
  await processQueuedIngestionJobs(client, auth.tenantId, { limit: 10 });
  if (options.autoApprove) {
    await submitKnowledgeVersionForReview(client, auth, created.version_id);
    await approveKnowledgeVersion(client, auth, created.version_id, `manifest import: ${entry.key}`);
  }
  return { key: entry.key, imported: true, source_id: created.source_id, version_id: created.version_id, auto_approved: Boolean(options.autoApprove) };
}
