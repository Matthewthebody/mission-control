import type { PoolClient } from "pg";
import type { WorkDepartmentType } from "../../domain/jobTruth/index.js";

export async function nextWorkTaskNumber(
  client: PoolClient,
  tenantId: string,
  department: WorkDepartmentType,
  now = new Date()
) {
  const prefix = department.slice(0, 3).toUpperCase();
  const year = now.getUTCFullYear().toString();
  const { rows } = await client.query<{ next_value: string }>(
    `
      SELECT (COALESCE(MAX(NULLIF(split_part(task_number, '-', 4), '')::bigint), 999) + 1)::text AS next_value
      FROM work_task
      WHERE tenant_id = $1
        AND department_type = $2::work_department_type
        AND split_part(task_number, '-', 1) = 'TSK'
        AND split_part(task_number, '-', 2) = $3
        AND split_part(task_number, '-', 3) = $4
    `,
    [tenantId, department, prefix, year]
  );
  const sequence = rows[0]?.next_value ?? "1000";
  return `TSK-${prefix}-${year}-${sequence.padStart(4, "0")}`;
}
