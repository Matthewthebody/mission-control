import { describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import {
  JOB_CATEGORIES,
  JOB_DAY_STATUSES,
  JOB_DEPARTMENT_TYPES,
  JOB_PRIORITY_LEVELS,
  JOB_PRODUCTION_STATUSES,
  JOB_READINESS_STATUSES,
  JOB_RISK_STATUSES,
  JOB_STAFFING_STATUSES,
  JOB_STATUSES,
  JOB_SYNC_STATUSES,
  JOB_WATCH_FLAG_SEVERITIES,
  JOB_WATCH_FLAG_STATUSES,
  WORK_ASSIGNMENT_STATUSES,
  WORK_ASSIGNMENT_TYPES,
  WORK_DEPARTMENT_TYPES,
  WORK_TASK_STATUSES
} from "../src/domain/jobTruth/index.js";

// Every canonical TS vocabulary that is persisted through a Postgres enum column.
// The DB enum must accept every TS value or writes crash at runtime with
// "invalid input value for enum" (e.g. the 5 production statuses added in
// migration 091 after the enum was created in 089). Extra DB-only values are
// allowed: enum values cannot be dropped, so the DB is a superset by design.
const ENUM_CONTRACTS: Array<{ enumName: string; tsValues: readonly string[] }> = [
  { enumName: "job_department_type", tsValues: JOB_DEPARTMENT_TYPES },
  { enumName: "job_category_type", tsValues: JOB_CATEGORIES },
  { enumName: "job_status_type", tsValues: JOB_STATUSES },
  { enumName: "job_day_status_type", tsValues: JOB_DAY_STATUSES },
  { enumName: "job_production_status_type", tsValues: JOB_PRODUCTION_STATUSES },
  { enumName: "job_staffing_status_type", tsValues: JOB_STAFFING_STATUSES },
  { enumName: "job_readiness_status_type", tsValues: JOB_READINESS_STATUSES },
  { enumName: "job_sync_status_type", tsValues: JOB_SYNC_STATUSES },
  { enumName: "job_risk_status_type", tsValues: JOB_RISK_STATUSES },
  { enumName: "job_priority_level", tsValues: JOB_PRIORITY_LEVELS },
  { enumName: "job_watch_flag_status_type", tsValues: JOB_WATCH_FLAG_STATUSES },
  { enumName: "job_watch_flag_severity_type", tsValues: JOB_WATCH_FLAG_SEVERITIES },
  { enumName: "work_department_type", tsValues: WORK_DEPARTMENT_TYPES },
  { enumName: "work_task_status_type", tsValues: WORK_TASK_STATUSES },
  { enumName: "work_assignment_type", tsValues: WORK_ASSIGNMENT_TYPES },
  { enumName: "work_assignment_status_type", tsValues: WORK_ASSIGNMENT_STATUSES }
];

describe("job truth enum drift guard", () => {
  it("keeps every database enum a superset of its canonical TS vocabulary", async () => {
    const result = await pool.query<{ enum_name: string; enum_values: string[] }>(
      `
        SELECT t.typname AS enum_name,
               array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS enum_values
        FROM pg_type t
        JOIN pg_enum e ON e.enumtypid = t.oid
        WHERE t.typname = ANY($1::text[])
        GROUP BY t.typname
      `,
      [ENUM_CONTRACTS.map((contract) => contract.enumName)]
    );
    const dbEnums = new Map(result.rows.map((row) => [row.enum_name, new Set(row.enum_values)]));

    const problems: string[] = [];
    for (const { enumName, tsValues } of ENUM_CONTRACTS) {
      const dbValues = dbEnums.get(enumName);
      if (!dbValues) {
        problems.push(`enum ${enumName} does not exist in the database`);
        continue;
      }
      const missing = tsValues.filter((value) => !dbValues.has(value));
      if (missing.length) {
        problems.push(
          `enum ${enumName} is missing values present in the canonical TS array: ${missing.join(", ")} ` +
            `(ship an ALTER TYPE ${enumName} ADD VALUE IF NOT EXISTS migration)`
        );
      }
    }

    expect(problems).toEqual([]);
  });
});
