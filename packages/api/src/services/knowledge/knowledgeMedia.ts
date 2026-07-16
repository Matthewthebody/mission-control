import type { PoolClient } from "pg";
import { ApiError } from "../../errors/apiError.js";
import type { AuthUser } from "../../types/auth.js";
import { readStoredObject, type StoredObjectRead } from "../s3.js";
import { buildVersionEligibilitySql } from "./knowledgeGovernance.js";

// Protected media access (charter H3-A/H3-F).
//
// A knowledge source's original asset may be streamed ONLY to a user for whom
// at least one version of that source is eligible under the same predicate
// retrieval uses — no direct-object access, no raw storage URLs, no guessed
// ids. The route serves bytes through the server (or an honest
// not_configured state when object storage is absent); credentials never
// reach the client.

export type PlayableMedia = {
  fileName: string | null;
  contentType: string | null;
  read: StoredObjectRead;
};

export async function getPlayableMedia(
  client: PoolClient,
  auth: AuthUser,
  sourceId: string
): Promise<PlayableMedia> {
  // Eligibility check: planning ∪ historical spans every authority class a
  // user can legitimately cite (operational/training classes plus
  // future-design and historical-only), with confidentiality and scope
  // enforced inside the predicate exactly as in retrieval.
  const params: unknown[] = [auth.tenantId, sourceId];
  const planningEligibility = buildVersionEligibilitySql(auth, "planning", params);
  const historicalEligibility = buildVersionEligibilitySql(auth, "historical", params);
  const eligible = await client.query<{ item_id: string | null }>(
    `SELECT s.resource_library_item_id::text AS item_id
     FROM knowledge_source s
     WHERE s.tenant_id = $1 AND s.id = $2
       AND EXISTS (
         SELECT 1 FROM knowledge_source_version v
         WHERE v.tenant_id = s.tenant_id AND v.source_id = s.id
           AND ((${planningEligibility}) OR (${historicalEligibility}))
       )
     LIMIT 1`,
    params
  );
  if (!eligible.rows[0]) {
    // Indistinguishable from a nonexistent source — no direct-object probing.
    throw new ApiError(404, "Source media not found.");
  }
  if (!eligible.rows[0].item_id) {
    throw new ApiError(404, "This source has no media asset.");
  }
  const asset = await client.query<{ storage_key: string | null; file_name: string | null; content_type: string | null }>(
    `SELECT storage_key, file_name, content_type FROM resource_library_item WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [auth.tenantId, eligible.rows[0].item_id]
  );
  const item = asset.rows[0];
  if (!item) {
    throw new ApiError(404, "Source media not found.");
  }
  if (!item.storage_key) {
    return {
      fileName: item.file_name,
      contentType: item.content_type,
      read: { status: "not_configured", reason: "This asset has no managed storage object." }
    };
  }
  const read = await readStoredObject(auth.tenantId, item.storage_key);
  return { fileName: item.file_name, contentType: item.content_type, read };
}

/** Server-built protected media URL for citations (H3-F). */
export function buildProtectedMediaUrl(sourceId: string, startSeconds: number | null): string {
  const base = `/api/ask-bailey/sources/${sourceId}/media`;
  return startSeconds != null ? `${base}#t=${Math.floor(startSeconds)}` : base;
}
