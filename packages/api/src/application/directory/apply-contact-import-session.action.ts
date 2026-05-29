import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { applyContactImportSession } from "../../services/directoryImports.js";

export async function applyContactImportSessionAction(
  client: PoolClient,
  auth: AuthUser,
  sessionId: string,
  input: {
    rows?: Array<{
      row_id: string;
      selected_action?: "create_contact" | "link_existing" | "skip" | "needs_review" | null;
      selected_contact_id?: string | null;
      resolved_organization_id?: string | null;
      review_note?: string | null;
    }>;
  } = {},
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  return applyContactImportSession(client, auth, sessionId, input, meta);
}
