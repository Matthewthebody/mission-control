import { mondayGraphQL } from "./mondayStub.js";
import { airtableRequest } from "./airtableStub.js";
import { Pool } from "pg";

export async function runMigrationStubs(input: {
  mondayToken?: string;
  airtableToken?: string;
  dbUrl?: string;
  tenantId?: string;
  objectType?: string;
  objectId?: string;
  externalId: string;
}) {
  const mappings: Array<{ provider: string; external_id: string; payload: unknown }> = [];
  if (input.mondayToken) {
    const mondayPayload = await mondayGraphQL("{ boards { id name } }", input.mondayToken);
    mappings.push({ provider: "monday", external_id: input.externalId, payload: mondayPayload });
  }
  if (input.airtableToken) {
    const airtablePayload = await airtableRequest("appExample/Table%201", input.airtableToken);
    mappings.push({ provider: "airtable", external_id: input.externalId, payload: airtablePayload });
  }
  if (input.dbUrl && input.tenantId && input.objectType) {
    const pool = new Pool({ connectionString: input.dbUrl });
    try {
      for (const mapping of mappings) {
        await pool.query(
          `
            INSERT INTO external_object_map (tenant_id, provider, external_id, object_type, object_id, payload)
            VALUES ($1,$2,$3,$4,$5,$6::jsonb)
            ON CONFLICT (tenant_id, provider, external_id, object_type)
            DO UPDATE SET object_id = EXCLUDED.object_id, payload = EXCLUDED.payload
          `,
          [
            input.tenantId,
            mapping.provider,
            mapping.external_id,
            input.objectType,
            input.objectId ?? null,
            JSON.stringify(mapping.payload)
          ]
        );
      }
    } finally {
      await pool.end();
    }
  }
  return mappings;
}
