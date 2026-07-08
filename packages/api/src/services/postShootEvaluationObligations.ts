import type { PoolClient } from "pg";
import type { AuthUser } from "../types/auth.js";
import { canReviewTeamTime } from "../authz/authority.js";
import { ApiError } from "../errors/apiError.js";

// SSA-2 — Post-shoot evaluation obligations (read model only, no writes).
// Matthew's rule: EVERY photographer assigned to a shoot owes a post-shoot evaluation, and
// without their own submitted eval their mileage reimbursement stays blocked (the canonical
// mileage gate in timeClockMileage.ts already enforces the payable side per photographer).
// There is no stored "expected evals" ledger — this model DERIVES the obligation set as a
// roster diff: non-cancelled shoot work_shifts (the assigned-photographer truth the mileage
// gate itself reads) minus that photographer's own submitted post_shoot_evaluation rows.
// It is deliberately agnostic to WHICH eval system captured the submission (the shift path
// and Job Closeout V1 both write post_shoot_evaluation), so the open canonical-eval-system
// decision does not change this contract. Cancelled/replaced shifts are excluded entirely —
// a photographer removed before the shoot does not owe an eval.

export type EvaluationObligationStatus = "required" | "submitted";
export type EvaluationTemplateType = "standard" | "lead_10_question";

export type EvaluationObligation = {
  obligation_id: string;
  shift_id: string;
  shoot_id: string;
  job_id: null; // shoot-spine model; the canonical jobs table is disjoint (no honest job link exists)
  organization_id: string | null;
  organization_name: string | null;
  location_id: string | null;
  location_name: string | null;
  shoot_title: string;
  shoot_code: string | null;
  shoot_date: string | null;
  employee_id: string;
  employee_name: string | null;
  role_on_shoot: string;
  is_lead: boolean;
  template_type: EvaluationTemplateType;
  status: EvaluationObligationStatus;
  due_at: string | null;
  submitted_at: string | null;
  blocks_mileage: boolean;
  exact_destination_hash: string;
  focus_reason: string;
};

export type EvaluationObligationsResult = {
  as_of: string;
  scope: "team";
  window_days: number;
  shoot_id: string | null;
  summary: {
    // Every count below equals the number of matching rows in the FULL derived set
    // (items may be capped for transport — see items_total/items_shown).
    total_obligations: number;
    submitted_count: number;
    outstanding_count: number;
    outstanding_lead_count: number;
    mileage_blocked_photographer_count: number;
    shoots_covered: number;
  };
  items_total: number;
  items_shown: number;
  items: EvaluationObligation[];
};

type ObligationRow = {
  shift_id: string;
  shoot_id: string;
  employee_id: string;
  employee_name: string | null;
  staffing_role: string;
  satisfies_lead_coverage: boolean;
  shoot_title: string;
  shoot_code: string | null;
  shoot_date: string | null;
  organization_id: string | null;
  organization_name: string | null;
  location_id: string | null;
  location_name: string | null;
  evaluation_id: string | null;
  submitted_at: string | null;
};

// Mirrors requiresLeadCloseout (postShootEvaluations.ts): lead coverage or a senior photographer
// carries the deeper lead/senior evaluation; everyone else owes the standard eval.
function isLeadObligation(row: Pick<ObligationRow, "satisfies_lead_coverage" | "staffing_role">) {
  return Boolean(row.satisfies_lead_coverage) || row.staffing_role === "senior_photographer";
}

// The Staff Assignment Board consumes ?date= (anchor) and ?shoot= (opens that shoot's drawer) —
// the verified-focus destination convention for shoot records.
function shootDestination(shootId: string, shootDate: string | null) {
  const params = new URLSearchParams();
  if (shootDate) params.set("date", shootDate);
  params.set("shoot", shootId);
  return `#operations/staffing?${params.toString()}`;
}

export async function getPostShootEvaluationObligations(
  client: PoolClient,
  auth: AuthUser,
  input: { shootId?: string | null; windowDays?: number; limit?: number } = {}
): Promise<EvaluationObligationsResult> {
  if (!canReviewTeamTime(auth)) {
    throw new ApiError(403, "You do not have access to the team evaluation obligations view.");
  }
  const windowDays = Math.min(Math.max(input.windowDays ?? 14, 1), 60);
  const limit = Math.min(Math.max(input.limit ?? 200, 1), 500);
  const params: unknown[] = [auth.tenantId, windowDays];
  let shootFilter = "";
  if (input.shootId) {
    params.push(input.shootId);
    shootFilter = `AND ws.shoot_id = $${params.length}`;
  }

  const { rows } = await client.query<ObligationRow>(
    `
      SELECT
        ws.id AS shift_id,
        ws.shoot_id,
        ws.assigned_user_id AS employee_id,
        au.full_name AS employee_name,
        ws.staffing_role::text AS staffing_role,
        ws.satisfies_lead_coverage,
        s.title AS shoot_title,
        s.shoot_code,
        s.shoot_date::text AS shoot_date,
        s.organization_id,
        o.display_name AS organization_name,
        s.location_id,
        s.location_name,
        pse.id AS evaluation_id,
        pse.created_at::text AS submitted_at
      FROM work_shift ws
      JOIN shoot s
        ON s.id = ws.shoot_id
       AND s.tenant_id = ws.tenant_id
      LEFT JOIN organization o
        ON o.id = s.organization_id
       AND o.tenant_id = ws.tenant_id
      LEFT JOIN app_user au
        ON au.id = ws.assigned_user_id
      LEFT JOIN post_shoot_evaluation pse
        ON pse.tenant_id = ws.tenant_id
       AND pse.shift_id = ws.id
       AND pse.photographer_user_id = ws.assigned_user_id
      WHERE ws.tenant_id = $1
        AND ws.shift_kind = 'shoot'
        AND ws.cancelled_at IS NULL
        AND s.deleted_at IS NULL
        AND s.record_state = 'published'
        AND COALESCE(s.shoot_date, ws.starts_at::date) <= CURRENT_DATE
        AND COALESCE(s.shoot_date, ws.starts_at::date) >= CURRENT_DATE - ($2 * INTERVAL '1 day')
        ${shootFilter}
      ORDER BY COALESCE(s.shoot_date, ws.starts_at::date) DESC, s.id, au.full_name NULLS LAST, ws.id
    `,
    params
  );

  const items: EvaluationObligation[] = rows.map((row) => {
    const lead = isLeadObligation(row);
    const submitted = Boolean(row.evaluation_id);
    return {
      obligation_id: `${row.shift_id}:${row.employee_id}`,
      shift_id: row.shift_id,
      shoot_id: row.shoot_id,
      job_id: null,
      organization_id: row.organization_id,
      organization_name: row.organization_name,
      location_id: row.location_id,
      location_name: row.location_name,
      shoot_title: row.shoot_title,
      shoot_code: row.shoot_code,
      shoot_date: row.shoot_date,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      role_on_shoot: row.staffing_role,
      is_lead: lead,
      template_type: lead ? "lead_10_question" : "standard",
      status: submitted ? "submitted" : "required",
      due_at: row.shoot_date,
      submitted_at: row.submitted_at,
      // Mirrors the canonical mileage gate: a photographer's OWN missing eval blocks THEIR mileage.
      blocks_mileage: !submitted,
      exact_destination_hash: shootDestination(row.shoot_id, row.shoot_date),
      focus_reason: submitted
        ? "Post-shoot evaluation submitted."
        : "Post-shoot evaluation not yet submitted — this photographer's mileage reimbursement stays blocked until it is."
    };
  });

  const outstanding = items.filter((item) => item.status === "required");
  return {
    as_of: new Date().toISOString(),
    scope: "team",
    window_days: windowDays,
    shoot_id: input.shootId ?? null,
    summary: {
      total_obligations: items.length,
      submitted_count: items.length - outstanding.length,
      outstanding_count: outstanding.length,
      outstanding_lead_count: outstanding.filter((item) => item.is_lead).length,
      mileage_blocked_photographer_count: new Set(outstanding.map((item) => item.employee_id)).size,
      shoots_covered: new Set(items.map((item) => item.shoot_id)).size
    },
    items_total: items.length,
    items_shown: Math.min(items.length, limit),
    items: items.slice(0, limit)
  };
}
