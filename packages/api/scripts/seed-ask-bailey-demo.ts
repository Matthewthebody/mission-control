import process from "node:process";
import type { PoolClient } from "pg";
import { pool } from "../src/db/pool.js";
import { withClientTransaction } from "../src/db/tx.js";
import type { AuthUser } from "../src/types/auth.js";
import {
  approveKnowledgeVersion,
  createKnowledgeSource,
  openKnowledgeConflict,
  submitKnowledgeVersionForReview
} from "../src/services/knowledge/knowledgeGovernance.js";
import { processQueuedIngestionJobs, queueIngestionJob } from "../src/services/knowledge/knowledgeIngestion.js";

// Ask Bailey demo seed — DEVELOPMENT ONLY.
//
// Every source created here is prefixed "[DEMO]" and described as demo-only so
// it can never be mistaken for production company policy. Content is invented
// for demonstration; it is NOT an approved Kemmetmueller procedure.
//
// The seed exercises the REAL lifecycle end to end — createKnowledgeSource →
// queueIngestionJob → processQueuedIngestionJobs → submit → approve — so the
// demo proves the actual vertical path, not a shortcut. Nothing is hand-written
// into segments or approval state.
//
// Idempotent: sources are looked up by exact title and skipped when present.

const DEMO_PREFIX = "[DEMO] ";
const DEMO_DESCRIPTION_SUFFIX =
  " — demo-only content seeded for Ask Bailey development. Not an approved production procedure.";

function assertDemoSeedAllowed(argv = process.argv, env = process.env) {
  if (env.NODE_ENV === "production") {
    throw new Error("Ask Bailey demo seed is disabled in production.");
  }
  if (!argv.includes("--allow-demo-data")) {
    throw new Error("Pass --allow-demo-data to confirm this development-only demo seed.");
  }
}

const TETHER_SOP_BODY = `# Tethered Shooting Setup

Connect the tether cable to the camera first, then to the workstation. Seat both ends fully — a half-seated tether cable is the most common cause of a dropped feed. Confirm Smart Shooter shows a live preview before the first student is posed.

# Recovering a Dropped Tether Feed

If the live feed drops during a session, stay calm and keep the line moving. Reseat the tether cable at the camera end first, then at the workstation. If the feed does not return within thirty seconds, restart Smart Shooter. Do not restart the workstation unless a trainer directs it.

# When to Escalate

If two recovery attempts fail, switch to card-based capture and notify the shoot lead immediately. Never send students away because of a technical problem without checking with the lead first.`;

const TETHER_VIDEO_SCRIPT = `[00:12-00:58] Welcome. In this demo training video we walk the tether recovery drill exactly as it runs on a school gym floor.
[06:42-07:31] Watch the cable seating check: press the tether connector at the camera body until it clicks, then trace the cable to the workstation and reseat that end too.
[07:31-08:44] If the Smart Shooter feed is still dark, close and reopen Smart Shooter. The roster and folder naming stay intact when you restart the app.
[08:44-09:30] Two failed recoveries means you switch to card capture and wave the shoot lead over. Keep the line moving while you wait.`;

const SD_STUDIO_BODY = `# SD Card Formatting

Format SD cards in camera at the start of each shoot day, after yesterday's uploads have been verified by the production team. A card must never leave the studio unformatted with prior-job images on it.`;

const SD_FIELD_BODY = `# SD Card Handling in the Field

Never format an SD card until the job has been delivered to the customer. Cards return from the field untouched and are archived for thirty days before reuse.`;

const CONFIDENTIAL_BODY = `# Pricing Escalation (Leadership Only)

When a district requests custom package pricing below the published floor, escalation goes to the owner directly. Do not discuss margin structure with school staff.`;

const FUTURE_DESIGN_BODY = `# Automated Culling Concept

A future workflow concept: after upload, an automated pass would flag blinks and severe exposure misses before a human review. This is a design idea under discussion — nothing about today's culling procedure changes.`;

const DRAFT_BODY = `# Proposed New Tether Kit

Proposal: replace the current tether kits with right-angle locking connectors. Pending hardware evaluation. This draft must never appear in operational answers.`;

type SeedSummary = {
  sources_created: number;
  sources_skipped: number;
  segments_indexed: number;
  conflict_opened: boolean;
  demo_media_item_id: string | null;
};

async function findLeadership(client: PoolClient) {
  const { rows } = await client.query<{ tenant_id: string; id: string }>(
    `SELECT tenant_id::text, id::text FROM app_user WHERE lower(email) = 'leadership@example.com' LIMIT 1`
  );
  if (!rows[0]) {
    throw new Error("Expected the dev seed user leadership@example.com to exist. Run the base seed first.");
  }
  return rows[0];
}

function reviewerAuth(tenantId: string, userId: string): AuthUser {
  return {
    id: userId,
    tenantId,
    authorityTier: "leadership",
    department: "executive",
    roles: ["leadership"],
    permissions: [],
    policyGrants: [],
    jobFunctionProfiles: []
  } as unknown as AuthUser;
}

async function sourceExists(client: PoolClient, tenantId: string, title: string) {
  const { rows } = await client.query(
    `SELECT id FROM knowledge_source WHERE tenant_id = $1 AND title = $2 LIMIT 1`,
    [tenantId, title]
  );
  return Boolean(rows[0]);
}

async function ensureDemoMediaItem(client: PoolClient, tenantId: string): Promise<string> {
  const fileName = "demo-bailey-tether-recovery-training.mp4";
  const existing = await client.query<{ id: string }>(
    `SELECT id::text FROM resource_library_item WHERE tenant_id = $1 AND file_name = $2 LIMIT 1`,
    [tenantId, fileName]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const created = await client.query<{ id: string }>(
    `INSERT INTO resource_library_item
       (tenant_id, resource_type, category, file_name, uploader_name, note, file_url, reference_kind)
     VALUES ($1, 'video', 'sop_reference', $2, 'Ask Bailey demo seed',
             'DEMO-ONLY placeholder video asset for Ask Bailey timestamp citations. No real media exists behind this URL.',
             '/demo-media/bailey/tether-recovery-training.mp4', 'uploaded_file')
     RETURNING id::text`,
    [tenantId, fileName]
  );
  return created.rows[0].id;
}

type SourceSpec = {
  title: string;
  description: string;
  sourceType: string;
  authorityClass: string;
  knowledgeMode?: string;
  inlineBody: string;
  confidential?: boolean;
  resourceLibraryItemId?: string | null;
  ingestKind: "document_extract" | "media_transcribe" | null;
  approve: boolean;
};

async function seedSource(client: PoolClient, auth: AuthUser, spec: SourceSpec): Promise<string | null> {
  if (await sourceExists(client, auth.tenantId, spec.title)) {
    return null;
  }
  const created = await createKnowledgeSource(client, auth, {
    title: spec.title,
    description: spec.description,
    sourceType: spec.sourceType,
    authorityClass: spec.authorityClass,
    knowledgeMode: spec.knowledgeMode,
    inlineBody: spec.inlineBody,
    confidential: spec.confidential,
    resourceLibraryItemId: spec.resourceLibraryItemId ?? null
  });
  if (spec.ingestKind) {
    await queueIngestionJob(client, auth.tenantId, created.version_id, spec.ingestKind, auth.id);
    await processQueuedIngestionJobs(client, auth.tenantId, { limit: 5 });
  }
  if (spec.approve) {
    await submitKnowledgeVersionForReview(client, auth, created.version_id);
    await approveKnowledgeVersion(client, auth, created.version_id, "Approved by Ask Bailey demo seed (demo-only content).");
  }
  return created.version_id;
}

export async function seedAskBaileyDemo(): Promise<SeedSummary> {
  const identityClient = await pool.connect();
  let identity: { tenant_id: string; id: string };
  try {
    identity = await findLeadership(identityClient);
  } finally {
    identityClient.release();
  }
  const tenantId = identity.tenant_id;
  const auth = reviewerAuth(tenantId, identity.id);

  const summary: SeedSummary = {
    sources_created: 0,
    sources_skipped: 0,
    segments_indexed: 0,
    conflict_opened: false,
    demo_media_item_id: null
  };

  await withClientTransaction(tenantId, identity.id, async (client) => {
    summary.demo_media_item_id = await ensureDemoMediaItem(client, tenantId);

    const specs: SourceSpec[] = [
      {
        title: `${DEMO_PREFIX}Tether Troubleshooting SOP`,
        description: `Demo SOP for tether setup and recovery${DEMO_DESCRIPTION_SUFFIX}`,
        sourceType: "written_sop",
        authorityClass: "approved_sop",
        inlineBody: TETHER_SOP_BODY,
        ingestKind: "document_extract",
        approve: true
      },
      {
        title: `${DEMO_PREFIX}Tether Recovery Training Video`,
        description: `Demo training video with a timed transcript${DEMO_DESCRIPTION_SUFFIX}`,
        sourceType: "training_video",
        authorityClass: "approved_training",
        inlineBody: TETHER_VIDEO_SCRIPT,
        resourceLibraryItemId: summary.demo_media_item_id,
        ingestKind: "media_transcribe",
        approve: true
      },
      {
        title: `${DEMO_PREFIX}SD Card Handling SOP (Studio)`,
        description: `Demo conflict pair, side A${DEMO_DESCRIPTION_SUFFIX}`,
        sourceType: "written_sop",
        authorityClass: "approved_sop",
        inlineBody: SD_STUDIO_BODY,
        ingestKind: "document_extract",
        approve: true
      },
      {
        title: `${DEMO_PREFIX}SD Card Handling Memo (Field)`,
        description: `Demo conflict pair, side B${DEMO_DESCRIPTION_SUFFIX}`,
        sourceType: "verified_expert_answer",
        authorityClass: "approved_expert_guidance",
        inlineBody: SD_FIELD_BODY,
        ingestKind: "document_extract",
        approve: true
      },
      {
        title: `${DEMO_PREFIX}Pricing Escalation Guidance (Confidential)`,
        description: `Demo confidential source — leadership tiers only${DEMO_DESCRIPTION_SUFFIX}`,
        sourceType: "company_policy",
        authorityClass: "official_company_policy",
        inlineBody: CONFIDENTIAL_BODY,
        confidential: true,
        ingestKind: "document_extract",
        approve: true
      },
      {
        title: `${DEMO_PREFIX}Future Design: Automated Culling Workflow`,
        description: `Demo future-design source — planning mode only${DEMO_DESCRIPTION_SUFFIX}`,
        sourceType: "future_design",
        authorityClass: "future_design_only",
        knowledgeMode: "planning",
        inlineBody: FUTURE_DESIGN_BODY,
        ingestKind: "document_extract",
        approve: true
      },
      {
        title: `${DEMO_PREFIX}Draft: New Tether Kit Proposal`,
        description: `Demo draft source — must never support an answer${DEMO_DESCRIPTION_SUFFIX}`,
        sourceType: "written_sop",
        authorityClass: "approved_sop",
        inlineBody: DRAFT_BODY,
        ingestKind: "document_extract",
        approve: false
      }
    ];

    const versionIdsByTitle = new Map<string, string>();
    for (const spec of specs) {
      const versionId = await seedSource(client, auth, spec);
      if (versionId) {
        summary.sources_created += 1;
        versionIdsByTitle.set(spec.title, versionId);
      } else {
        summary.sources_skipped += 1;
      }
    }

    const conflictA = versionIdsByTitle.get(`${DEMO_PREFIX}SD Card Handling SOP (Studio)`);
    const conflictB = versionIdsByTitle.get(`${DEMO_PREFIX}SD Card Handling Memo (Field)`);
    if (conflictA && conflictB) {
      await openKnowledgeConflict(client, auth, {
        versionAId: conflictA,
        versionBId: conflictB,
        note: "DEMO conflict: studio SOP says format in camera after verified upload; field memo says never format until delivery."
      });
      summary.conflict_opened = true;
    }

    const segments = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM knowledge_segment seg
       JOIN knowledge_source_version v ON v.id = seg.source_version_id
       JOIN knowledge_source s ON s.id = v.source_id
       WHERE seg.tenant_id = $1 AND s.title LIKE '${DEMO_PREFIX}%'`,
      [tenantId]
    );
    summary.segments_indexed = segments.rows[0]?.n ?? 0;
  });

  return summary;
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("seed-ask-bailey-demo.ts");
if (isDirectRun) {
  assertDemoSeedAllowed();
  seedAskBaileyDemo()
    .then((summary) => {
      console.log("Ask Bailey demo seed complete:", JSON.stringify(summary, null, 2));
      return pool.end();
    })
    .catch(async (error) => {
      console.error("Ask Bailey demo seed failed:", error);
      await pool.end();
      process.exitCode = 1;
    });
}
