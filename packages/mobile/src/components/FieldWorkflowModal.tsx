import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { v4 as uuidv4 } from "uuid";
import type { ShiftRecord } from "../screens/Shoot";
import { deleteFieldFormDraft, loadFieldFormDraft, saveFieldFormDraft } from "../fieldFormDrafts";
import {
  FIELD_WORKFLOW_TEMPLATES,
  acknowledgeBriefing,
  buildFieldWorkflowDraftKey,
  defaultPostSubmitMessage,
  fetchEmployeeShiftDetailFormContext,
  submitAttendanceException,
  submitAvailabilityRequest,
  submitEmployeeShiftFieldWorkflow,
  submitMissedPunchRequest,
  type EmployeeShiftDetailFormContext,
  type FieldIssueSeverity,
  type FieldWorkflowKind
} from "../fieldForms";
import { enqueueOfflineRequest } from "../offlineQueue";

type Props = {
  visible: boolean;
  token: string;
  workflowKind: FieldWorkflowKind;
  shift: ShiftRecord | null;
  onClose: () => void;
  onSubmitted: (message: string) => void;
  captureLocation?: () => Promise<{ latitude: number; longitude: number; accuracy: number | null } | null>;
};

const FIELD_ISSUE_CATEGORY_OPTIONS = [
  { value: "staffing", label: "Staffing" },
  { value: "attendance_no_show", label: "Attendance / No-Show" },
  { value: "setup_room_problem", label: "Setup / Room Problem" },
  { value: "parking_load_in", label: "Parking / Load-In" },
  { value: "school_readiness", label: "School Readiness" },
  { value: "data_roster", label: "Data / Roster" },
  { value: "equipment_technical", label: "Equipment / Technical" },
  { value: "lighting_environment", label: "Lighting / Environment" },
  { value: "line_flow_traffic", label: "Line Flow / Traffic" },
  { value: "student_parent_flow", label: "Student / Parent Flow" },
  { value: "communication_contact_issue", label: "Communication / Contact Issue" },
  { value: "special_product_deliverable_issue", label: "Special Product / Deliverable Issue" },
  { value: "other", label: "Other" }
] as const;

const SEVERITY_OPTIONS: Array<{ value: FieldIssueSeverity; label: string; detail: string }> = [
  { value: "minor", label: "Minor", detail: "Needs a record, but not an immediate interrupt." },
  { value: "major", label: "Major", detail: "Needs manager review quickly." },
  { value: "immediate_help_needed", label: "Immediate Help Needed", detail: "Treat this like an operational interrupt." }
];

const LOCATION_MEMORY_TYPE_OPTIONS = [
  { value: "parking_load_in", label: "Parking / Load-In" },
  { value: "entrance_check_in", label: "Entrance / Check-In" },
  { value: "setup_guidance", label: "Setup Guidance" },
  { value: "staffing_recommendation", label: "Staffing Recommendation" },
  { value: "day_of_coordination", label: "Day-Of Coordination" },
  { value: "top_watch_out", label: "Top Watch-Out" }
] as const;

const DIRECTORY_UPDATE_TYPE_OPTIONS = [
  { value: "contact_info_changed", label: "Contact Info Changed" },
  { value: "title_changed", label: "Title Changed" },
  { value: "new_contact", label: "New Contact" },
  { value: "wrong_contact", label: "Wrong Contact" },
  { value: "owner_change_suggestion", label: "Owner Change Suggestion" }
] as const;

const STAFFING_HELP_TYPE_OPTIONS = [
  { value: "running_late", label: "Running Late" },
  { value: "cannot_cover", label: "Cannot Cover" },
  { value: "need_replacement", label: "Need Replacement" },
  { value: "team_member_missing", label: "Team Member Missing" },
  { value: "coverage_at_risk", label: "Coverage At Risk" }
] as const;

const PTO_TYPE_OPTIONS = [
  { value: "full_day_off", label: "Full Day Off" },
  { value: "partial_day_off", label: "Partial Day Off" },
  { value: "multi_day_off", label: "Multi-Day Off" },
  { value: "sick_illness", label: "Sick / Illness" },
  { value: "personal_appointment", label: "Personal / Appointment" },
  { value: "unavailable_for_assignment", label: "Unavailable for Assignment" },
  { value: "availability_restriction_update", label: "Availability Restriction Update" }
] as const;

const CORRECTION_TYPES = [
  { value: "FORGOT_TO_CLOCK_IN", label: "Forgot to clock in" },
  { value: "FORGOT_TO_CLOCK_OUT", label: "Forgot to clock out" },
  { value: "WRONG_LOCATION", label: "Location issue / GPS review" },
  { value: "WRONG_SEGMENT", label: "Wrong assignment / segment" },
  { value: "WRONG_RATE", label: "Time looks wrong" }
] as const;

export function FieldWorkflowModal({ visible, token, workflowKind, shift, onClose, onSubmitted, captureLocation }: Props) {
  const template = FIELD_WORKFLOW_TEMPLATES[workflowKind];
  const draftKey = useMemo(() => buildFieldWorkflowDraftKey(workflowKind, shift?.id ?? null), [workflowKind, shift?.id]);
  const [context, setContext] = useState<EmployeeShiftDetailFormContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);

  const [briefingQuestionEnabled, setBriefingQuestionEnabled] = useState(false);
  const [briefingIssueCategory, setBriefingIssueCategory] = useState<string>("communication_contact_issue");
  const [briefingIssueSeverity, setBriefingIssueSeverity] = useState<FieldIssueSeverity>("minor");
  const [briefingIssueSummary, setBriefingIssueSummary] = useState("");

  const [correctionType, setCorrectionType] = useState<string>("FORGOT_TO_CLOCK_IN");
  const [correctionReason, setCorrectionReason] = useState("");
  const [correctionRequestedTime, setCorrectionRequestedTime] = useState("");
  const [correctionRequestedEndTime, setCorrectionRequestedEndTime] = useState("");
  const [correctionWorkState, setCorrectionWorkState] = useState<"office_drive" | "photography">("photography");

  const [ptoRequestType, setPtoRequestType] = useState<string>("full_day_off");
  const [ptoStartDate, setPtoStartDate] = useState("");
  const [ptoEndDate, setPtoEndDate] = useState("");
  const [ptoAllDay, setPtoAllDay] = useState(true);
  const [ptoStartTime, setPtoStartTime] = useState("");
  const [ptoEndTime, setPtoEndTime] = useState("");
  const [ptoReasonCategory, setPtoReasonCategory] = useState("");
  const [ptoNote, setPtoNote] = useState("");

  const [fieldIssueCategory, setFieldIssueCategory] = useState<string>("setup_room_problem");
  const [fieldIssueSeverity, setFieldIssueSeverity] = useState<FieldIssueSeverity>("minor");
  const [fieldIssueSummary, setFieldIssueSummary] = useState("");
  const [fieldIssueNote, setFieldIssueNote] = useState("");
  const [fieldIssueFollowUp, setFieldIssueFollowUp] = useState(false);

  const [memoryType, setMemoryType] = useState<string>("top_watch_out");
  const [memorySummary, setMemorySummary] = useState("");
  const [memoryWhyItMatters, setMemoryWhyItMatters] = useState("");
  const [memoryUsefulForFutureCrews, setMemoryUsefulForFutureCrews] = useState(true);

  const [directoryUpdateType, setDirectoryUpdateType] = useState<string>("contact_info_changed");
  const [directorySubjectName, setDirectorySubjectName] = useState("");
  const [directorySummary, setDirectorySummary] = useState("");
  const [directorySuggestedChange, setDirectorySuggestedChange] = useState("");

  const [staffingHelpType, setStaffingHelpType] = useState<string>("coverage_at_risk");
  const [staffingHelpSeverity, setStaffingHelpSeverity] = useState<FieldIssueSeverity>("major");
  const [staffingHelpSummary, setStaffingHelpSummary] = useState("");
  const [staffingRequestedPartner, setStaffingRequestedPartner] = useState("");

  useEffect(() => {
    if (!visible) {
      return;
    }

    setError("");
    setNotice("");
    setDraftRestored(false);
    resetFormState();

    if (workflowKind === "pto_availability_request") {
      const today = getTodayDateString();
      setPtoStartDate(today);
      setPtoEndDate(today);
      restoreDraft();
      return;
    }

    if (!shift) {
      return;
    }

    setLoadingContext(true);
    void fetchEmployeeShiftDetailFormContext(token, shift.id)
      .then((payload) => {
        setContext(payload);
        setCorrectionRequestedTime(shift.starts_at);
        setCorrectionRequestedEndTime(shift.ends_at);
        setCorrectionWorkState(getRecommendedClockInWorkState(shift));
        restoreDraft();
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "We couldn't load the field workflow context.");
      })
      .finally(() => {
        setLoadingContext(false);
      });
  }, [visible, workflowKind, shift, token]);

  function resetFormState() {
    setContext(null);
    setBriefingQuestionEnabled(false);
    setBriefingIssueCategory("communication_contact_issue");
    setBriefingIssueSeverity("minor");
    setBriefingIssueSummary("");
    setCorrectionType("FORGOT_TO_CLOCK_IN");
    setCorrectionReason("");
    setCorrectionRequestedTime(shift?.starts_at ?? "");
    setCorrectionRequestedEndTime(shift?.ends_at ?? "");
    setCorrectionWorkState(shift ? getRecommendedClockInWorkState(shift) : "photography");
    setPtoRequestType("full_day_off");
    setPtoAllDay(true);
    setPtoStartTime("");
    setPtoEndTime("");
    setPtoReasonCategory("");
    setPtoNote("");
    setFieldIssueCategory("setup_room_problem");
    setFieldIssueSeverity("minor");
    setFieldIssueSummary("");
    setFieldIssueNote("");
    setFieldIssueFollowUp(false);
    setMemoryType("top_watch_out");
    setMemorySummary("");
    setMemoryWhyItMatters("");
    setMemoryUsefulForFutureCrews(true);
    setDirectoryUpdateType("contact_info_changed");
    setDirectorySubjectName("");
    setDirectorySummary("");
    setDirectorySuggestedChange("");
    setStaffingHelpType("coverage_at_risk");
    setStaffingHelpSeverity("major");
    setStaffingHelpSummary("");
    setStaffingRequestedPartner("");
  }

  function restoreDraft() {
    const saved = loadFieldFormDraft(draftKey);
    if (!saved) {
      return;
    }
    const payload = saved.payload;
    setDraftRestored(true);
    switch (workflowKind) {
      case "briefing_acknowledgement":
        setBriefingQuestionEnabled(Boolean(payload.briefing_question_enabled));
        setBriefingIssueCategory(String(payload.briefing_issue_category ?? "communication_contact_issue"));
        setBriefingIssueSeverity((payload.briefing_issue_severity as FieldIssueSeverity) ?? "minor");
        setBriefingIssueSummary(String(payload.briefing_issue_summary ?? ""));
        break;
      case "attendance_time_correction_request":
        setCorrectionType(String(payload.correction_type ?? "FORGOT_TO_CLOCK_IN"));
        setCorrectionReason(String(payload.correction_reason ?? ""));
        setCorrectionRequestedTime(String(payload.correction_requested_time ?? shift?.starts_at ?? ""));
        setCorrectionRequestedEndTime(String(payload.correction_requested_end_time ?? shift?.ends_at ?? ""));
        setCorrectionWorkState((payload.correction_work_state as "office_drive" | "photography") ?? getRecommendedClockInWorkState(shift));
        break;
      case "pto_availability_request":
        setPtoRequestType(String(payload.pto_request_type ?? "full_day_off"));
        setPtoStartDate(String(payload.pto_start_date ?? getTodayDateString()));
        setPtoEndDate(String(payload.pto_end_date ?? getTodayDateString()));
        setPtoAllDay(Boolean(payload.pto_all_day ?? true));
        setPtoStartTime(String(payload.pto_start_time ?? ""));
        setPtoEndTime(String(payload.pto_end_time ?? ""));
        setPtoReasonCategory(String(payload.pto_reason_category ?? ""));
        setPtoNote(String(payload.pto_note ?? ""));
        break;
      case "field_issue_report":
        setFieldIssueCategory(String(payload.field_issue_category ?? "setup_room_problem"));
        setFieldIssueSeverity((payload.field_issue_severity as FieldIssueSeverity) ?? "minor");
        setFieldIssueSummary(String(payload.field_issue_summary ?? ""));
        setFieldIssueNote(String(payload.field_issue_note ?? ""));
        setFieldIssueFollowUp(Boolean(payload.field_issue_follow_up));
        break;
      case "location_memory_suggestion":
        setMemoryType(String(payload.memory_type ?? "top_watch_out"));
        setMemorySummary(String(payload.memory_summary ?? ""));
        setMemoryWhyItMatters(String(payload.memory_why_it_matters ?? ""));
        setMemoryUsefulForFutureCrews(Boolean(payload.memory_useful_for_future_crews ?? true));
        break;
      case "directory_update_suggestion":
        setDirectoryUpdateType(String(payload.directory_update_type ?? "contact_info_changed"));
        setDirectorySubjectName(String(payload.directory_subject_name ?? ""));
        setDirectorySummary(String(payload.directory_summary ?? ""));
        setDirectorySuggestedChange(String(payload.directory_suggested_change ?? ""));
        break;
      case "staffing_help_request":
        setStaffingHelpType(String(payload.staffing_help_type ?? "coverage_at_risk"));
        setStaffingHelpSeverity((payload.staffing_help_severity as FieldIssueSeverity) ?? "major");
        setStaffingHelpSummary(String(payload.staffing_help_summary ?? ""));
        setStaffingRequestedPartner(String(payload.staffing_requested_partner ?? ""));
        break;
    }
  }

  function buildDraftPayload() {
    switch (workflowKind) {
      case "briefing_acknowledgement":
        return {
          briefing_question_enabled: briefingQuestionEnabled,
          briefing_issue_category: briefingIssueCategory,
          briefing_issue_severity: briefingIssueSeverity,
          briefing_issue_summary: briefingIssueSummary
        };
      case "attendance_time_correction_request":
        return {
          correction_type: correctionType,
          correction_reason: correctionReason,
          correction_requested_time: correctionRequestedTime,
          correction_requested_end_time: correctionRequestedEndTime,
          correction_work_state: correctionWorkState
        };
      case "pto_availability_request":
        return {
          pto_request_type: ptoRequestType,
          pto_start_date: ptoStartDate,
          pto_end_date: ptoEndDate,
          pto_all_day: ptoAllDay,
          pto_start_time: ptoStartTime,
          pto_end_time: ptoEndTime,
          pto_reason_category: ptoReasonCategory,
          pto_note: ptoNote
        };
      case "field_issue_report":
        return {
          field_issue_category: fieldIssueCategory,
          field_issue_severity: fieldIssueSeverity,
          field_issue_summary: fieldIssueSummary,
          field_issue_note: fieldIssueNote,
          field_issue_follow_up: fieldIssueFollowUp
        };
      case "location_memory_suggestion":
        return {
          memory_type: memoryType,
          memory_summary: memorySummary,
          memory_why_it_matters: memoryWhyItMatters,
          memory_useful_for_future_crews: memoryUsefulForFutureCrews
        };
      case "directory_update_suggestion":
        return {
          directory_update_type: directoryUpdateType,
          directory_subject_name: directorySubjectName,
          directory_summary: directorySummary,
          directory_suggested_change: directorySuggestedChange
        };
      case "staffing_help_request":
        return {
          staffing_help_type: staffingHelpType,
          staffing_help_severity: staffingHelpSeverity,
          staffing_help_summary: staffingHelpSummary,
          staffing_requested_partner: staffingRequestedPartner
        };
    }
  }

  function handleSaveDraft() {
    saveFieldFormDraft({
      draftKey,
      formKind: workflowKind,
      shiftId: shift?.id ?? null,
      payload: buildDraftPayload()
    });
    setNotice("Saved locally on this device. You can come back and finish it later.");
    setDraftRestored(false);
  }

  async function queueJsonSubmission(path: string, payload: Record<string, unknown>, successMessage: string) {
    const requestId = uuidv4();
    enqueueOfflineRequest({
      id: requestId,
      shootId: shift?.shoot_id ?? null,
      path,
      method: "POST",
      headers: {
        "Idempotency-Key": requestId
      },
      payload
    });
    deleteFieldFormDraft(draftKey);
    onSubmitted(successMessage);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const netState = await NetInfo.fetch();
      const isOnline = Boolean(netState.isConnected);

      if (workflowKind === "briefing_acknowledgement") {
        if (!shift) {
          throw new Error("Shift context is required.");
        }
        if (!isOnline) {
          await queueJsonSubmission(`/api/employee/shifts/${shift.id}/acknowledge`, {}, defaultPostSubmitMessage(workflowKind, true));
          onClose();
          return;
        }

        await acknowledgeBriefing(token, shift.id);
        if (briefingQuestionEnabled && briefingIssueSummary.trim()) {
          await submitEmployeeShiftFieldWorkflow(token, shift.id, {
            form_type: "field_issue_report",
            issue_category: briefingIssueCategory,
            severity: briefingIssueSeverity,
            summary: briefingIssueSummary.trim(),
            note: "Raised while acknowledging the pre-service briefing.",
            follow_up_needed: briefingIssueSeverity !== "minor"
          });
        }
        deleteFieldFormDraft(draftKey);
        onSubmitted(defaultPostSubmitMessage(workflowKind, false));
        onClose();
        return;
      }

      if (workflowKind === "attendance_time_correction_request") {
        if (!shift) {
          throw new Error("Shift context is required.");
        }
        const location = captureLocation ? await captureLocation() : null;
        const isMissedPunch = correctionType === "FORGOT_TO_CLOCK_IN" || correctionType === "FORGOT_TO_CLOCK_OUT";
        const payload = isMissedPunch
          ? {
              shift_id: shift.id,
              missing_direction: correctionType === "FORGOT_TO_CLOCK_IN" ? "in" : "out",
              employee_submitted_explanation: correctionReason.trim() || "Submitted from the mobile field workflow.",
              requested_approver_user_id: shift.manager_user_id ?? null,
              corrected_time:
                correctionType === "FORGOT_TO_CLOCK_IN"
                  ? correctionRequestedTime || shift.starts_at
                  : correctionRequestedEndTime || shift.ends_at,
              requested_work_state: correctionWorkState,
              requested_start_time: correctionRequestedTime || shift.starts_at,
              requested_end_time: correctionRequestedEndTime || null,
              location_context: location
                ? {
                    latitude: location.latitude,
                    longitude: location.longitude,
                    accuracy_meters: location.accuracy ?? null
                  }
                : null,
              notes: correctionReason.trim() || null
            }
          : {
              shift_id: shift.id,
              exception_type: correctionType,
              reason_code: "other",
              notes: correctionReason.trim() || "Submitted from the mobile field workflow.",
              requested_approver_user_id: shift.manager_user_id ?? null
            };

        if (!isOnline) {
          await queueJsonSubmission(
            isMissedPunch ? "/api/attendance/missed-punches" : "/api/attendance/exceptions",
            payload,
            defaultPostSubmitMessage(workflowKind, true)
          );
          onClose();
          return;
        }

        if (isMissedPunch) {
          await submitMissedPunchRequest(token, payload);
        } else {
          await submitAttendanceException(token, payload);
        }
        deleteFieldFormDraft(draftKey);
        onSubmitted(defaultPostSubmitMessage(workflowKind, false));
        onClose();
        return;
      }

      if (workflowKind === "pto_availability_request") {
        const payload = {
          request_type: ptoRequestType,
          start_date: ptoStartDate,
          end_date: ptoEndDate || null,
          all_day: ptoAllDay,
          start_time: ptoAllDay ? null : ptoStartTime || null,
          end_time: ptoAllDay ? null : ptoEndTime || null,
          reason_category: ptoReasonCategory.trim() || null,
          note: ptoNote.trim() || null
        };

        if (!isOnline) {
          await queueJsonSubmission("/api/shifts/pto-requests", payload, defaultPostSubmitMessage(workflowKind, true));
          onClose();
          return;
        }

        await submitAvailabilityRequest(token, payload);
        deleteFieldFormDraft(draftKey);
        onSubmitted(defaultPostSubmitMessage(workflowKind, false));
        onClose();
        return;
      }

      if (!shift) {
        throw new Error("Shift context is required.");
      }

      const submissionPayload =
        workflowKind === "field_issue_report"
          ? {
              form_type: "field_issue_report",
              issue_category: fieldIssueCategory,
              severity: fieldIssueSeverity,
              summary: fieldIssueSummary.trim(),
              note: fieldIssueNote.trim() || null,
              follow_up_needed: fieldIssueFollowUp
            }
          : workflowKind === "location_memory_suggestion"
            ? {
                form_type: "location_memory_suggestion",
                memory_type: memoryType,
                summary: memorySummary.trim(),
                why_it_matters: memoryWhyItMatters.trim() || null,
                useful_for_future_crews: memoryUsefulForFutureCrews
              }
            : workflowKind === "directory_update_suggestion"
              ? {
                  form_type: "directory_update_suggestion",
                  update_type: directoryUpdateType,
                  subject_name: directorySubjectName.trim() || null,
                  summary: directorySummary.trim(),
                  suggested_change: directorySuggestedChange.trim() || null
                }
              : {
                  form_type: "staffing_help_request",
                  issue_type: staffingHelpType,
                  severity: staffingHelpSeverity,
                  summary: staffingHelpSummary.trim(),
                  requested_partner_user_id: staffingRequestedPartner.trim() || null
                };

      if (!isOnline) {
        await queueJsonSubmission(`/api/employee/shifts/${shift.id}/form-submissions`, submissionPayload, defaultPostSubmitMessage(workflowKind, true));
        onClose();
        return;
      }

      const result = await submitEmployeeShiftFieldWorkflow(token, shift.id, submissionPayload);
      deleteFieldFormDraft(draftKey);
      onSubmitted(result.next_step_message || defaultPostSubmitMessage(workflowKind, false));
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "We couldn't submit that form.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#f4f7fb" }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={sheetHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontSize: 24, fontWeight: "800", color: "#102237" }}>{template.title}</Text>
              <Text style={mutedText}>{template.subtitle}</Text>
            </View>
            <Pressable onPress={onClose} style={closeButton}>
              <Text style={{ color: "#0f4a87", fontWeight: "700" }}>Close</Text>
            </Pressable>
          </View>

          {loadingContext ? (
            <View style={panelStyle}>
              <ActivityIndicator />
              <Text style={mutedText}>Loading assignment context...</Text>
            </View>
          ) : null}

          {draftRestored ? <Text style={infoText}>Saved draft restored from this device.</Text> : null}
          {error ? <Text style={errorText}>{error}</Text> : null}
          {notice ? <Text style={infoText}>{notice}</Text> : null}

          {shift ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Context</Text>
              <MetadataRow label="Assignment" value={shift.shoot_code ?? shift.title} />
              <MetadataRow label="Window" value={`${new Date(shift.starts_at).toLocaleString()} - ${new Date(shift.ends_at).toLocaleTimeString()}`} />
              <MetadataRow label="Location" value={`${shift.location_name}${shift.location_address ? ` | ${shift.location_address}` : ""}`} />
              <MetadataRow label="Role" value={shift.staffing_role ? humanizeCode(shift.staffing_role) : humanizeCode(shift.shift_kind)} />
              {context?.pre_service_notes?.summary_line ? <MetadataRow label="Briefing" value={context.pre_service_notes.summary_line} /> : null}
              {context?.location_context?.location_memory_summary ? <MetadataRow label="Location Memory" value={context.location_context.location_memory_summary} /> : null}
            </View>
          ) : null}

          <View style={panelStyle}>
            <Text style={sectionTitle}>What Happens Next</Text>
            <Text style={mutedText}>{template.reviewLabel}</Text>
            <Text style={mutedText}>{template.offlineLabel}</Text>
            <Text style={mutedText}>{template.nextStepLabel}</Text>
          </View>

          {workflowKind === "briefing_acknowledgement" ? renderBriefingForm({
            context,
            briefingQuestionEnabled,
            setBriefingQuestionEnabled,
            briefingIssueCategory,
            setBriefingIssueCategory,
            briefingIssueSeverity,
            setBriefingIssueSeverity,
            briefingIssueSummary,
            setBriefingIssueSummary
          }) : null}

          {workflowKind === "attendance_time_correction_request" ? renderCorrectionForm({
            correctionType,
            setCorrectionType,
            correctionWorkState,
            setCorrectionWorkState,
            correctionRequestedTime,
            setCorrectionRequestedTime,
            correctionRequestedEndTime,
            setCorrectionRequestedEndTime,
            correctionReason,
            setCorrectionReason
          }) : null}

          {workflowKind === "pto_availability_request" ? renderPtoForm({
            ptoRequestType,
            setPtoRequestType,
            ptoStartDate,
            setPtoStartDate,
            ptoEndDate,
            setPtoEndDate,
            ptoAllDay,
            setPtoAllDay,
            ptoStartTime,
            setPtoStartTime,
            ptoEndTime,
            setPtoEndTime,
            ptoReasonCategory,
            setPtoReasonCategory,
            ptoNote,
            setPtoNote
          }) : null}

          {workflowKind === "field_issue_report" ? renderFieldIssueForm({
            fieldIssueCategory,
            setFieldIssueCategory,
            fieldIssueSeverity,
            setFieldIssueSeverity,
            fieldIssueSummary,
            setFieldIssueSummary,
            fieldIssueNote,
            setFieldIssueNote,
            fieldIssueFollowUp,
            setFieldIssueFollowUp
          }) : null}

          {workflowKind === "location_memory_suggestion" ? renderLocationMemoryForm({
            memoryType,
            setMemoryType,
            memorySummary,
            setMemorySummary,
            memoryWhyItMatters,
            setMemoryWhyItMatters,
            memoryUsefulForFutureCrews,
            setMemoryUsefulForFutureCrews
          }) : null}

          {workflowKind === "directory_update_suggestion" ? renderDirectoryForm({
            directoryUpdateType,
            setDirectoryUpdateType,
            directorySubjectName,
            setDirectorySubjectName,
            directorySummary,
            setDirectorySummary,
            directorySuggestedChange,
            setDirectorySuggestedChange
          }) : null}

          {workflowKind === "staffing_help_request" ? renderStaffingForm({
            staffingHelpType,
            setStaffingHelpType,
            staffingHelpSeverity,
            setStaffingHelpSeverity,
            staffingHelpSummary,
            setStaffingHelpSummary,
            staffingRequestedPartner,
            setStaffingRequestedPartner
          }) : null}

          <View style={panelStyle}>
            <View style={{ gap: 10 }}>
              <ActionButton label="Save Draft" variant="secondary" onPress={handleSaveDraft} />
              <ActionButton label={submitting ? "Submitting..." : "Submit"} disabled={submitting} onPress={() => void handleSubmit()} />
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function renderBriefingForm(input: {
  context: EmployeeShiftDetailFormContext | null;
  briefingQuestionEnabled: boolean;
  setBriefingQuestionEnabled: (value: boolean) => void;
  briefingIssueCategory: string;
  setBriefingIssueCategory: (value: string) => void;
  briefingIssueSeverity: FieldIssueSeverity;
  setBriefingIssueSeverity: (value: FieldIssueSeverity) => void;
  briefingIssueSummary: string;
  setBriefingIssueSummary: (value: string) => void;
}) {
  return (
    <View style={panelStyle}>
      <Text style={sectionTitle}>Briefing Check</Text>
      {input.context?.pre_service_notes?.highlights?.length ? (
        input.context.pre_service_notes.highlights.slice(0, 4).map((highlight, index) => (
          <View key={`${highlight.label}-${index}`} style={bulletRow}>
            <Text style={bulletDot}>•</Text>
            <Text style={mutedText}>
              <Text style={{ fontWeight: "700", color: "#102237" }}>{highlight.label}: </Text>
              {highlight.text}
            </Text>
          </View>
        ))
      ) : (
        <Text style={mutedText}>No extra briefing notes were attached to this assignment.</Text>
      )}
      <View style={toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={fieldLabel}>I have a question or issue</Text>
          <Text style={mutedText}>Use this only if the briefing surfaced something that needs follow-up.</Text>
        </View>
        <Switch value={input.briefingQuestionEnabled} onValueChange={input.setBriefingQuestionEnabled} />
      </View>
      {input.briefingQuestionEnabled ? (
        <View style={{ gap: 10 }}>
          <ChoiceRow label="Issue category" value={input.briefingIssueCategory} onChange={input.setBriefingIssueCategory} options={FIELD_ISSUE_CATEGORY_OPTIONS} />
          <ChoiceRow
            label="Severity"
            value={input.briefingIssueSeverity}
            onChange={(value) => input.setBriefingIssueSeverity(value as FieldIssueSeverity)}
            options={SEVERITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          />
          <LabeledInput label="Question or issue summary" value={input.briefingIssueSummary} multiline onChangeText={input.setBriefingIssueSummary} />
        </View>
      ) : null}
    </View>
  );
}

function renderCorrectionForm(input: {
  correctionType: string;
  setCorrectionType: (value: string) => void;
  correctionWorkState: "office_drive" | "photography";
  setCorrectionWorkState: (value: "office_drive" | "photography") => void;
  correctionRequestedTime: string;
  setCorrectionRequestedTime: (value: string) => void;
  correctionRequestedEndTime: string;
  setCorrectionRequestedEndTime: (value: string) => void;
  correctionReason: string;
  setCorrectionReason: (value: string) => void;
}) {
  return (
    <View style={panelStyle}>
      <Text style={sectionTitle}>Correction Details</Text>
      <ChoiceRow label="Issue type" value={input.correctionType} onChange={input.setCorrectionType} options={CORRECTION_TYPES} />
      <ChoiceRow
        label="Work state"
        value={input.correctionWorkState}
        onChange={(value) => input.setCorrectionWorkState(value as "office_drive" | "photography")}
        options={[
          { value: "office_drive", label: "Office / Drive" },
          { value: "photography", label: "Photography" }
        ]}
      />
      <LabeledInput label="Suggested clock time" value={input.correctionRequestedTime} onChangeText={input.setCorrectionRequestedTime} />
      <LabeledInput label="Suggested end time" value={input.correctionRequestedEndTime} onChangeText={input.setCorrectionRequestedEndTime} />
      <LabeledInput
        label="Short reason"
        value={input.correctionReason}
        multiline
        hint="Keep it specific and short so the manager can review it quickly."
        onChangeText={input.setCorrectionReason}
      />
    </View>
  );
}

function renderPtoForm(input: {
  ptoRequestType: string;
  setPtoRequestType: (value: string) => void;
  ptoStartDate: string;
  setPtoStartDate: (value: string) => void;
  ptoEndDate: string;
  setPtoEndDate: (value: string) => void;
  ptoAllDay: boolean;
  setPtoAllDay: (value: boolean) => void;
  ptoStartTime: string;
  setPtoStartTime: (value: string) => void;
  ptoEndTime: string;
  setPtoEndTime: (value: string) => void;
  ptoReasonCategory: string;
  setPtoReasonCategory: (value: string) => void;
  ptoNote: string;
  setPtoNote: (value: string) => void;
}) {
  return (
    <View style={panelStyle}>
      <Text style={sectionTitle}>Request Details</Text>
      <ChoiceRow label="Request type" value={input.ptoRequestType} onChange={input.setPtoRequestType} options={PTO_TYPE_OPTIONS} />
      <LabeledInput label="Start date" value={input.ptoStartDate} onChangeText={input.setPtoStartDate} hint="Use YYYY-MM-DD." />
      <LabeledInput label="End date" value={input.ptoEndDate} onChangeText={input.setPtoEndDate} hint="Use the same day for a single-day request." />
      <View style={toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={fieldLabel}>All day</Text>
          <Text style={mutedText}>Turn this off for a partial-day window.</Text>
        </View>
        <Switch value={input.ptoAllDay} onValueChange={input.setPtoAllDay} />
      </View>
      {!input.ptoAllDay ? (
        <>
          <LabeledInput label="Start time" value={input.ptoStartTime} onChangeText={input.setPtoStartTime} hint="Use HH:MM in local time." />
          <LabeledInput label="End time" value={input.ptoEndTime} onChangeText={input.setPtoEndTime} hint="Use HH:MM in local time." />
        </>
      ) : null}
      <LabeledInput label="Reason category" value={input.ptoReasonCategory} onChangeText={input.setPtoReasonCategory} />
      <LabeledInput label="Note" value={input.ptoNote} multiline hint="Add only the context your approver needs." onChangeText={input.setPtoNote} />
    </View>
  );
}

function renderFieldIssueForm(input: {
  fieldIssueCategory: string;
  setFieldIssueCategory: (value: string) => void;
  fieldIssueSeverity: FieldIssueSeverity;
  setFieldIssueSeverity: (value: FieldIssueSeverity) => void;
  fieldIssueSummary: string;
  setFieldIssueSummary: (value: string) => void;
  fieldIssueNote: string;
  setFieldIssueNote: (value: string) => void;
  fieldIssueFollowUp: boolean;
  setFieldIssueFollowUp: (value: boolean) => void;
}) {
  return (
    <View style={panelStyle}>
      <Text style={sectionTitle}>Issue Details</Text>
      <ChoiceRow label="Category" value={input.fieldIssueCategory} onChange={input.setFieldIssueCategory} options={FIELD_ISSUE_CATEGORY_OPTIONS} />
      <ChoiceRow
        label="Severity"
        value={input.fieldIssueSeverity}
        onChange={(value) => input.setFieldIssueSeverity(value as FieldIssueSeverity)}
        options={SEVERITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      />
      <LabeledInput label="Short summary" value={input.fieldIssueSummary} multiline onChangeText={input.setFieldIssueSummary} />
      <LabeledInput label="Additional detail" value={input.fieldIssueNote} multiline onChangeText={input.setFieldIssueNote} />
      <View style={toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={fieldLabel}>Follow-up needed</Text>
          <Text style={mutedText}>Use this when the issue should stay visible after today.</Text>
        </View>
        <Switch value={input.fieldIssueFollowUp} onValueChange={input.setFieldIssueFollowUp} />
      </View>
    </View>
  );
}

function renderLocationMemoryForm(input: {
  memoryType: string;
  setMemoryType: (value: string) => void;
  memorySummary: string;
  setMemorySummary: (value: string) => void;
  memoryWhyItMatters: string;
  setMemoryWhyItMatters: (value: string) => void;
  memoryUsefulForFutureCrews: boolean;
  setMemoryUsefulForFutureCrews: (value: boolean) => void;
}) {
  return (
    <View style={panelStyle}>
      <Text style={sectionTitle}>Memory Suggestion</Text>
      <ChoiceRow label="Memory type" value={input.memoryType} onChange={input.setMemoryType} options={LOCATION_MEMORY_TYPE_OPTIONS} />
      <LabeledInput label="Suggestion summary" value={input.memorySummary} multiline onChangeText={input.setMemorySummary} />
      <LabeledInput label="Why it matters" value={input.memoryWhyItMatters} multiline onChangeText={input.setMemoryWhyItMatters} />
      <View style={toggleRow}>
        <View style={{ flex: 1 }}>
          <Text style={fieldLabel}>Useful for future crews</Text>
          <Text style={mutedText}>Keep this on only for reusable, respectful guidance.</Text>
        </View>
        <Switch value={input.memoryUsefulForFutureCrews} onValueChange={input.setMemoryUsefulForFutureCrews} />
      </View>
    </View>
  );
}

function renderDirectoryForm(input: {
  directoryUpdateType: string;
  setDirectoryUpdateType: (value: string) => void;
  directorySubjectName: string;
  setDirectorySubjectName: (value: string) => void;
  directorySummary: string;
  setDirectorySummary: (value: string) => void;
  directorySuggestedChange: string;
  setDirectorySuggestedChange: (value: string) => void;
}) {
  return (
    <View style={panelStyle}>
      <Text style={sectionTitle}>Directory Suggestion</Text>
      <ChoiceRow label="Update type" value={input.directoryUpdateType} onChange={input.setDirectoryUpdateType} options={DIRECTORY_UPDATE_TYPE_OPTIONS} />
      <LabeledInput label="Contact or subject name" value={input.directorySubjectName} onChangeText={input.setDirectorySubjectName} />
      <LabeledInput label="Short summary" value={input.directorySummary} multiline onChangeText={input.setDirectorySummary} />
      <LabeledInput label="Suggested change" value={input.directorySuggestedChange} multiline onChangeText={input.setDirectorySuggestedChange} />
    </View>
  );
}

function renderStaffingForm(input: {
  staffingHelpType: string;
  setStaffingHelpType: (value: string) => void;
  staffingHelpSeverity: FieldIssueSeverity;
  setStaffingHelpSeverity: (value: FieldIssueSeverity) => void;
  staffingHelpSummary: string;
  setStaffingHelpSummary: (value: string) => void;
  staffingRequestedPartner: string;
  setStaffingRequestedPartner: (value: string) => void;
}) {
  return (
    <View style={panelStyle}>
      <Text style={sectionTitle}>Coverage Risk</Text>
      <ChoiceRow label="Issue type" value={input.staffingHelpType} onChange={input.setStaffingHelpType} options={STAFFING_HELP_TYPE_OPTIONS} />
      <ChoiceRow
        label="Severity"
        value={input.staffingHelpSeverity}
        onChange={(value) => input.setStaffingHelpSeverity(value as FieldIssueSeverity)}
        options={SEVERITY_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      />
      <LabeledInput label="Short summary" value={input.staffingHelpSummary} multiline onChangeText={input.setStaffingHelpSummary} />
      <LabeledInput
        label="Requested partner user ID (optional)"
        value={input.staffingRequestedPartner}
        hint="Only use this if you already know who might help."
        onChangeText={input.setStaffingRequestedPartner}
      />
    </View>
  );
}

function ChoiceRow({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable key={option.value} onPress={() => onChange(option.value)} style={chipStyle(selected)}>
              <Text style={{ color: selected ? "#ffffff" : "#0f4a87", fontWeight: "700" }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  multiline,
  hint
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholderTextColor="#7b8794"
        style={[inputStyle, multiline ? { minHeight: 96, textAlignVertical: "top" } : null]}
      />
      {hint ? <Text style={mutedText}>{hint}</Text> : null}
    </View>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={fieldLabel}>{label}</Text>
      <Text style={mutedText}>{value}</Text>
    </View>
  );
}

function getRecommendedClockInWorkState(shift: ShiftRecord | null) {
  if (!shift) {
    return "photography" as const;
  }
  if (shift.shift_kind === "studio" || shift.shift_kind === "office" || shift.shift_kind === "training") {
    return "office_drive" as const;
  }
  return "photography" as const;
}

function humanizeCode(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function ActionButton({
  label,
  onPress,
  variant = "primary",
  disabled
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
}) {
  const primary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        backgroundColor: disabled ? "#cbd5e1" : primary ? "#0f4a87" : "#dbeafe",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        alignItems: "center"
      }}
    >
      <Text style={{ color: primary ? "#ffffff" : "#0f4a87", fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

const sheetHeader = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12
};

const closeButton = {
  paddingHorizontal: 14,
  paddingVertical: 10,
  borderRadius: 999,
  backgroundColor: "#e2e8f0"
};

const panelStyle = {
  backgroundColor: "#ffffff",
  borderRadius: 18,
  padding: 18,
  gap: 12,
  shadowColor: "#0f172a",
  shadowOpacity: 0.08,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2
};

const fieldLabel = {
  fontSize: 13,
  fontWeight: "700" as const,
  color: "#102237"
};

const sectionTitle = {
  fontSize: 18,
  fontWeight: "800" as const,
  color: "#102237"
};

const mutedText = {
  color: "#526276",
  lineHeight: 20
};

const infoText = {
  color: "#0f4a87",
  lineHeight: 20
};

const errorText = {
  color: "#b91c1c",
  lineHeight: 20
};

const inputStyle = {
  borderWidth: 1,
  borderColor: "#cbd5e1",
  borderRadius: 14,
  paddingHorizontal: 14,
  paddingVertical: 12,
  color: "#102237",
  backgroundColor: "#f8fafc"
};

const toggleRow = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 12
};

const bulletRow = {
  flexDirection: "row" as const,
  gap: 8,
  alignItems: "flex-start" as const
};

const bulletDot = {
  color: "#0f4a87",
  fontWeight: "800" as const,
  marginTop: 1
};

function chipStyle(selected: boolean) {
  return {
    backgroundColor: selected ? "#0f4a87" : "#dbeafe",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999
  };
}
