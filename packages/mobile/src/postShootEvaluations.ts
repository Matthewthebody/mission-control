import { mobileFetch } from "./api";

export type PostShootOverallStatus = "successful" | "completed_with_issues" | "significant_issue";
export type MileageVehicleType = "personal_vehicle" | "carpool_passenger" | "company_vehicle" | "other_needs_review";
export type MileageReimbursementStatus =
  | "candidate"
  | "review_required"
  | "ineligible"
  | "approved"
  | "exported"
  | "cancelled"
  | "not_applicable";

export type ShiftCloseoutCompliance = {
  shift_id: string;
  shoot_id: string | null;
  organization_id: string | null;
  location_id: string | null;
  reminder_threshold_minutes: number;
  setup_photo_required: boolean;
  setup_photo_uploaded: boolean;
  setup_photo_reminder_due: boolean;
  post_shoot_evaluation_required: boolean;
  post_shoot_evaluation_submitted: boolean;
  missing_required_items: Array<"setup_photo" | "post_shoot_evaluation">;
  last_post_shoot_evaluation: {
    id: string;
    submitted_at: string;
    overall_shoot_status: PostShootOverallStatus;
    went_well: string | null;
    remember_next_time: string | null;
    issue_flag: boolean;
    open_comment: string | null;
    submit_for_mileage: boolean;
    vehicle_type: MileageVehicleType | null;
  } | null;
  mileage_reimbursement: {
    work_date: string;
    mileage_eligible: boolean;
    status: MileageReimbursementStatus;
    review_reason_code: string | null;
    reimbursement_amount: string | null;
    zone_name: string | null;
    vehicle_type: MileageVehicleType | null;
    studio_distance_miles: number | null;
    issue_label: string | null;
    selected_shoot: {
      id: string;
      shoot_code: string | null;
      title: string | null;
    } | null;
  } | null;
  warning_message?: string | null;
};

export type PostShootEvaluationContext = {
  shift: {
    id: string;
    shoot_id: string | null;
    shoot_code: string | null;
    shoot_title: string | null;
    staffing_role: string | null;
    satisfies_lead_coverage: boolean;
    location_name: string | null;
    location_address: string | null;
  };
  linked_records: {
    shoot: {
      id: string;
      shoot_code: string | null;
      title: string;
    } | null;
    organization: {
      id: string;
      display_name: string;
    } | null;
    location: {
      id: string;
      name: string;
      address: string | null;
    } | null;
  };
  closeout_compliance: ShiftCloseoutCompliance | null;
};

export async function fetchPostShootEvaluationContext(token: string, shiftId: string) {
  return mobileFetch<PostShootEvaluationContext>(`/api/employee/shifts/${shiftId}`, token);
}

export async function submitPostShootEvaluation(
  token: string,
  shiftId: string,
  input: {
    overallShootStatus: PostShootOverallStatus;
    wentWell?: string | null;
    rememberNextTime?: string | null;
    issueFlag?: boolean;
    openComment?: string | null;
    submitForMileage?: boolean;
    vehicleType?: MileageVehicleType | null;
  }
) {
  return mobileFetch<{
    evaluation: {
      id: string;
      shift_id: string;
      shoot_id: string | null;
      organization_id: string | null;
      organization_display_name: string | null;
      location_id: string | null;
      location_name: string | null;
      submitted_at: string;
      overall_shoot_status: PostShootOverallStatus;
      went_well: string | null;
      remember_next_time: string | null;
      issue_flag: boolean;
      open_comment: string | null;
      submit_for_mileage: boolean;
      vehicle_type: MileageVehicleType | null;
    };
    closeout_compliance: ShiftCloseoutCompliance | null;
    mileage_reimbursement: ShiftCloseoutCompliance["mileage_reimbursement"];
  }>(`/api/employee/shifts/${shiftId}/post-shoot-evaluation`, token, {
    method: "POST",
    body: JSON.stringify({
      overall_shoot_status: input.overallShootStatus,
      went_well: input.wentWell ?? null,
      remember_next_time: input.rememberNextTime ?? null,
      issue_flag: Boolean(input.issueFlag),
      open_comment: input.openComment ?? null,
      submit_for_mileage: Boolean(input.submitForMileage),
      vehicle_type: input.vehicleType ?? null
    })
  });
}

export function humanizePostShootEvaluationError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return fallback;
  }
  if (/already submitted/i.test(message)) {
    return "This Post-Shoot Evaluation is already locked in for this shift.";
  }
  if (/must be linked to an Organization and Location/i.test(message)) {
    return "This Shoot still needs a linked Organization and Location before the evaluation can be saved.";
  }
  if (/network request failed/i.test(message)) {
    return "We couldn't reach Mission Control. Check your connection and try again.";
  }
  return message;
}
