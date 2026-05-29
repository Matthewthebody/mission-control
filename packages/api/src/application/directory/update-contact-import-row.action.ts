import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { updateContactImportRow } from "../../services/directoryImports.js";

export async function updateContactImportRowAction(
  client: PoolClient,
  auth: AuthUser,
  sessionId: string,
  rowId: string,
  input: {
    selected_action?: "create_contact" | "link_existing" | "skip" | "needs_review" | null;
    selected_contact_id?: string | null;
    resolved_organization_id?: string | null;
    review_note?: string | null;
  }
) {
  return updateContactImportRow(client, auth, sessionId, rowId, input);
}
