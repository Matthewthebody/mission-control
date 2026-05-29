import { withClientTransaction } from "../src/db/tx.js";
import { pool } from "../src/db/pool.js";
import { seedChecklistDefaults } from "../src/services/jobTruth/checklistSeedService.js";
import type { AuthUser } from "../src/types/auth.js";

type SeedArgs = {
  tenantId: string;
  userEmail: string;
};

function parseArgs(argv: string[]): SeedArgs {
  const args = new Map<string, string>();
  for (const value of argv) {
    const match = value.match(/^--([^=]+)=(.+)$/);
    if (match) {
      args.set(match[1], match[2]);
    }
  }
  const tenantId = args.get("tenant");
  const userEmail = args.get("user") ?? "leadership@example.com";
  if (!tenantId) {
    throw new Error("Provide --tenant=<tenant-id>.");
  }
  return { tenantId, userEmail };
}

async function loadActor(tenantId: string, userEmail: string) {
  const result = await pool.query<{
    id: string;
    email: string;
    full_name: string;
    department: string | null;
  }>(
    `
      SELECT
        id::text AS id,
        email,
        full_name,
        department::text AS department
      FROM app_user
      WHERE tenant_id = $1
        AND lower(email) = lower($2)
      LIMIT 1
    `,
    [tenantId, userEmail]
  );
  const actor = result.rows[0];
  if (!actor) {
    throw new Error(`Could not find ${userEmail} in tenant ${tenantId}.`);
  }
  return actor;
}

function buildSystemAuth(tenantId: string, actor: Awaited<ReturnType<typeof loadActor>>): AuthUser {
  return {
    id: actor.id,
    tenantId,
    accountId: null,
    sessionId: "seed-workflow-checklists",
    email: actor.email,
    fullName: actor.full_name,
    status: "active",
    department: (actor.department ?? "operations") as AuthUser["department"],
    isEmailVerified: true,
    authVersion: 1,
    authorityTier: "super_admin",
    baseRole: "Admin",
    capabilityOverlays: ["Finance", "CommunicationsModerator", "UserAccessAdmin", "SecurityAdmin"],
    jobFunctionProfiles: ["leadership_team_member"],
    primaryJobFunctionProfile: "leadership_team_member",
    permissionGrants: [],
    policyGrants: [],
    policyRoles: ["admin"],
    effectiveScopes: ["organization_wide_scope"],
    authorizationFlags: {
      financeSensitiveAccess: true,
      communicationsModeration: true,
      userAccessAdministration: true,
      securityAdministration: true
    },
    roles: ["admin"],
    permissions: [
      "checklist.template.read",
      "checklist.template.manage",
      "checklist.approve",
      "checklist.waive",
      "checklist.override.soft_block"
    ],
    sessionTrust: {
      identityProvider: "dev",
      sessionAssurance: "phishing_resistant",
      requestTransport: "bearer",
      authenticatedAt: new Date().toISOString(),
      lastReauthenticatedAt: null,
      activeAuthContextIds: [],
      elevatedUntil: null,
      privilegedModeUntil: null,
      breakGlassStartedAt: null,
      breakGlassUntil: null,
      breakGlassReason: null,
      breakGlassScopeType: null,
      breakGlassScopeId: null,
      elevatedSessionActive: false,
      privilegedModeActive: false,
      breakGlassModeActive: false
    }
  };
}

async function main() {
  const { tenantId, userEmail } = parseArgs(process.argv.slice(2));
  const actor = await loadActor(tenantId, userEmail);
  const auth = buildSystemAuth(tenantId, actor);
  const result = await withClientTransaction(tenantId, actor.id, async (client) => seedChecklistDefaults(client, auth));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
