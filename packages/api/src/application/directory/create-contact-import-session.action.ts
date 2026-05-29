import type { PoolClient } from "pg";
import type { AuthUser } from "../../types/auth.js";
import { createContactImportSession } from "../../services/directoryImports.js";

export async function createContactImportSessionAction(
  client: PoolClient,
  auth: AuthUser,
  input: {
    source_file_name: string;
    csv_text: string;
    has_header_row?: boolean;
    default_organization_id?: string | null;
    column_mapping?: Record<string, string | null | undefined>;
  },
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  return createContactImportSession(client, auth, input, meta);
}
