import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { v4 as uuidv4 } from "uuid";
import { mobileFetch } from "../api";
import { getToken } from "../auth";
import { enqueueOfflineRequest, getOfflineQueueCount } from "../offlineQueue";
import { syncOfflineQueue, type SyncOfflineQueueResult } from "../syncer";
import { OperationalUploadModal } from "../components/OperationalUploadModal";
import { PostShootEvaluationModal } from "../components/PostShootEvaluationModal";
import { GearQrScanModal } from "../components/GearQrScanModal";
import { FieldWorkflowModal } from "../components/FieldWorkflowModal";
import type { FieldWorkflowKind } from "../fieldForms";
import type { UploadTargetType } from "../resourceUploads";

type ShiftSegment = {
  id: string;
  segment_kind: string;
  label: string;
  rate_code: string;
  hourly_rate_cents: number;
  actual_start_at?: string | null;
  actual_end_at?: string | null;
  scheduled_start_at: string;
  scheduled_end_at: string;
};

type ShiftPunch = {
  id: string;
  direction: "in" | "out";
  client_timestamp: string;
  geofence_status: string;
  gps_confidence: string;
  approval_state: string;
  timing_status?: string;
  late_minutes?: number | null;
  early_minutes?: number | null;
  missed_punch_required?: boolean;
};

type ShiftCloseoutCompliance = {
  reminder_threshold_minutes: number;
  setup_photo_required: boolean;
  setup_photo_uploaded: boolean;
  setup_photo_reminder_due: boolean;
  post_shoot_evaluation_required: boolean;
  post_shoot_evaluation_submitted: boolean;
  missing_required_items: Array<"setup_photo" | "post_shoot_evaluation">;
  mileage_reimbursement?: {
    work_date: string;
    mileage_eligible: boolean;
    status: "candidate" | "review_required" | "ineligible" | "approved" | "exported" | "cancelled" | "not_applicable";
    review_reason_code: string | null;
    reimbursement_amount: string | null;
    zone_name: string | null;
    vehicle_type: "personal_vehicle" | "carpool_passenger" | "company_vehicle" | "other_needs_review" | null;
    studio_distance_miles: number | null;
    issue_label: string | null;
  } | null;
  warning_message?: string | null;
  compliance_flags?: Array<{
    id: string;
    item_type: string;
    item_label: string;
    severity: "warning" | "high";
    message: string;
    last_detected_at: string;
  }>;
};

type TimeClockStateSummary = {
  session_id: string | null;
  session_status: "open" | "closed" | "needs_end_of_day_confirmation" | "approved" | "payroll_exported" | "off_clock";
  current_state: "off_clock" | "office_drive" | "photography";
  current_segment_id: string | null;
  current_segment_review_status: "not_required" | "pending_review" | "approved" | "rejected" | null;
  current_linked_shoot_id: string | null;
  current_linked_location_id: string | null;
  current_segment_started_at: string | null;
  needs_end_of_day_confirmation: boolean;
  last_clock_event_at: string | null;
};

type Coworker = {
  id: string;
  full_name: string;
  email?: string | null;
  roles: string[];
};

export type ShiftRecord = {
  id: string;
  title: string;
  shift_kind: string;
  status: string;
  staffing_role?: string | null;
  satisfies_lead_coverage?: boolean;
  starts_at: string;
  ends_at: string;
  location_name: string;
  location_address: string;
  navigation_url?: string | null;
  assigned_user_id: string;
  assigned_user_name: string;
  manager_name?: string | null;
  manager_user_id?: string | null;
  shoot_id?: string | null;
  shoot_code?: string | null;
  shoot_title?: string | null;
  attendance_state?: string;
  attendance_state_note?: string | null;
  punches: ShiftPunch[];
  segments: ShiftSegment[];
  coworkers?: Coworker[];
  exceptions?: Array<{ id: string; exception_type: string; status: string }>;
  closeout_compliance?: ShiftCloseoutCompliance | null;
  time_clock_state?: TimeClockStateSummary | null;
  payroll_summary?: {
    id: string;
    clock_in_at: string;
    clock_out_at?: string | null;
    gross_minutes?: number | null;
    break_deduction_minutes?: number | null;
    break_deduction_applied?: boolean;
    approved_payable_minutes?: number | null;
    payroll_state?: string | null;
    attendance_state?: string | null;
    break_deduction_overridden?: boolean;
  } | null;
};

type NotificationRecord = {
  id: string;
  title: string;
  body: string;
  channel: string;
  priority: string;
  status: string;
  created_at: string;
};

type PunchResponse = {
  exceptions?: Array<{ exception_type: string }>;
  punch: { gps_confidence: string };
  closeout_compliance?: ShiftCloseoutCompliance | null;
  time_clock_state?: TimeClockStateSummary | null;
  time_clock_warnings?: string[];
};

type ShiftWorkflowState = {
  isClockedIn: boolean;
  hasPunchHistory: boolean;
  primaryDirection: "in" | "out";
  primaryActionKind: "clock_in" | "clock_out" | "request_missed_clock_in" | "request_missed_clock_out" | "confirm_end_of_day";
  primaryActionLabel: string;
  statusTitle: string;
  statusDetail: string;
  workflowHint: string;
  reviewNote: string | null;
};

type LocationCheckResponse = {
  time_clock_state: TimeClockStateSummary;
  auto_transition: {
    kind: "office_drive_to_photography" | "photography_to_office_drive";
    message: string;
    shift_id: string | null;
    shoot_id: string | null;
  } | null;
  likely_present_missing_clock_in: {
    shift_id: string;
    shoot_id: string | null;
    title: string;
    distance_miles: number;
    label: "Likely Present, Missing Clock-In";
  } | null;
  needs_end_of_day_confirmation: {
    session_id: string;
    title: "Needs End-of-Day Confirmation";
    prompt: string;
  } | null;
};

const REASON_CODES = [
  { value: "", label: "No exception reason" },
  { value: "approved_early", label: "Approved early start" },
  { value: "traffic", label: "Traffic / delayed arrival" },
  { value: "equipment_issue", label: "Equipment / load-in issue" },
  { value: "gps_issue", label: "GPS or signal issue" },
  { value: "outside_geofence", label: "Outside expected location" },
  { value: "unscheduled_support", label: "Unscheduled support requested" },
  { value: "other", label: "Other" }
];

const CORRECTION_TYPES = [
  { value: "FORGOT_TO_CLOCK_IN", label: "Forgot to clock in" },
  { value: "FORGOT_TO_CLOCK_OUT", label: "Forgot to clock out" },
  { value: "WRONG_LOCATION", label: "Wrong location / GPS issue" },
  { value: "WRONG_SEGMENT", label: "Wrong segment" },
  { value: "WRONG_RATE", label: "Wrong segment rate" }
];

const NO_LUNCH_CHALLENGE_REASONS = [
  { value: "worked_through_lunch", label: "Worked Through Lunch" },
  { value: "travel_and_load_in", label: "Travel / Load-In Ran Through Lunch" },
  { value: "schedule_density", label: "Schedule Density" },
  { value: "site_delay", label: "Site Delay / Timing Change" },
  { value: "other", label: "Other" }
];

export function ShootScreen() {
  const [scheduleDate] = useState(getLocalDateString());
  const [filterText, setFilterText] = useState("");
  const [shifts, setShifts] = useState<ShiftRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [syncMessage, setSyncMessage] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [screenError, setScreenError] = useState("");
  const [busyShiftId, setBusyShiftId] = useState("");
  const [shiftMessages, setShiftMessages] = useState<Record<string, string>>({});
  const [reasonByShift, setReasonByShift] = useState<Record<string, string>>({});
  const [notesByShift, setNotesByShift] = useState<Record<string, string>>({});
  const [approverByShift, setApproverByShift] = useState<Record<string, string>>({});
  const [attestedApprovedByShift, setAttestedApprovedByShift] = useState<Record<string, boolean>>({});
  const [tradePartnerByShift, setTradePartnerByShift] = useState<Record<string, string>>({});
  const [correctionTypeByShift, setCorrectionTypeByShift] = useState<Record<string, string>>({});
  const [correctionStartByShift, setCorrectionStartByShift] = useState<Record<string, string>>({});
  const [correctionEndByShift, setCorrectionEndByShift] = useState<Record<string, string>>({});
  const [correctionWorkStateByShift, setCorrectionWorkStateByShift] = useState<Record<string, "office_drive" | "photography">>({});
  const [noLunchReasonByShift, setNoLunchReasonByShift] = useState<Record<string, string>>({});
  const [noLunchNoteByShift, setNoLunchNoteByShift] = useState<Record<string, string>>({});
  const [uploadShift, setUploadShift] = useState<ShiftRecord | null>(null);
  const [uploadTarget, setUploadTarget] = useState<UploadTargetType>("shoot");
  const [evaluationShift, setEvaluationShift] = useState<ShiftRecord | null>(null);
  const [gearShift, setGearShift] = useState<ShiftRecord | null>(null);
  const [clockInShift, setClockInShift] = useState<ShiftRecord | null>(null);
  const [clockInWorkState, setClockInWorkState] = useState<"office_drive" | "photography">("photography");
  const [endOfDayShift, setEndOfDayShift] = useState<ShiftRecord | null>(null);
  const [endOfDayNote, setEndOfDayNote] = useState("");
  const [workflowModal, setWorkflowModal] = useState<{ kind: FieldWorkflowKind; shift: ShiftRecord | null } | null>(null);
  const [advancedReviewVisibleByShift, setAdvancedReviewVisibleByShift] = useState<Record<string, boolean>>({});

  const visibleShifts = useMemo(() => {
    const filter = filterText.trim().toLowerCase();
    if (!filter) {
      return shifts;
    }

    return shifts.filter((shift) => {
      const haystack = [
        shift.title,
        shift.shoot_code ?? "",
        shift.shoot_title ?? "",
        shift.location_name,
        shift.location_address
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(filter);
    });
  }, [filterText, shifts]);

  useEffect(() => {
    void (async () => {
      await loadSchedule();
      await runTimeClockLocationCheck();
      refreshQueueState();
    })();
  }, []);

  useEffect(() => {
    let previousOnline = true;

    void NetInfo.fetch().then((state) => {
      const connected = Boolean(state.isConnected);
      setIsOnline(connected);
      previousOnline = connected;
    });

    const unsubscribe = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected);
      setIsOnline(connected);
      if (connected && !previousOnline) {
        void runSync("Connection restored");
      }
      previousOnline = connected;
    });

    return () => {
      unsubscribe();
    };
  }, []);

  async function loadSchedule() {
    setIsLoading(true);
    setScreenError("");
    try {
      const token = getToken();
      const shiftRows = await mobileFetch<ShiftRecord[]>(
        `/api/shifts?date_from=${scheduleDate}&date_to=${scheduleDate}`,
        token
      );
      const detailedRows = await Promise.all(
        shiftRows.map(async (shift) => {
          try {
            return await mobileFetch<ShiftRecord>(`/api/shifts/${shift.id}`, token);
          } catch {
            return shift;
          }
        })
      );
      const notificationRows = await mobileFetch<NotificationRecord[]>("/api/notifications", token).catch(() => []);
      setShifts(detailedRows);
      setNotifications(notificationRows.slice(0, 8));
    } catch (error) {
      setScreenError(humanizeMobileError(error, "We couldn't load today's shifts."));
    } finally {
      setIsLoading(false);
    }
  }

  function refreshQueueState() {
    setQueueCount(getOfflineQueueCount());
  }

  function setShiftMessage(shiftId: string, message: string) {
    setShiftMessages((current) => ({
      ...current,
      [shiftId]: message
    }));
  }

  async function runSync(reason?: string) {
    if (isSyncing) {
      return;
    }
    setIsSyncing(true);
    try {
      const result = await syncOfflineQueue();
      refreshQueueState();
      if (result.skippedOffline) {
        setSyncMessage("Still offline. Queued updates are safe on this device.");
        return;
      }

      setSyncMessage(buildSyncMessage(result, reason));
      if (result.synced > 0) {
        await loadSchedule();
      }
    } finally {
      setIsSyncing(false);
    }
  }

  async function runTimeClockLocationCheck() {
    const state = await NetInfo.fetch();
    if (!state.isConnected) {
      return;
    }

    const location = await getCurrentLocation();
    if (!location) {
      return;
    }

    try {
      const response = await mobileFetch<LocationCheckResponse>("/api/attendance/time-clock/location-check", getToken(), {
        method: "POST",
        body: JSON.stringify({
          captured_at: new Date().toISOString(),
          latitude: location.latitude,
          longitude: location.longitude,
          accuracy_meters: location.accuracy ?? null
        })
      });

      if (response.likely_present_missing_clock_in?.shift_id) {
        setShiftMessage(
          response.likely_present_missing_clock_in.shift_id,
          `${response.likely_present_missing_clock_in.label}. You're within ${response.likely_present_missing_clock_in.distance_miles.toFixed(2)} miles of the Shoot but still Off Clock.`
        );
      }

      if (response.auto_transition?.message) {
        setSyncMessage(response.auto_transition.message);
        await loadSchedule();
        return;
      }

      if (response.needs_end_of_day_confirmation?.prompt) {
        setSyncMessage(response.needs_end_of_day_confirmation.prompt);
        await loadSchedule();
      }
    } catch {
      // Field foreground checks should not block the rest of the shift screen.
    }
  }

  async function submitPunch(
    shift: ShiftRecord,
    direction: "in" | "out",
    options?: {
      workState?: "office_drive" | "photography";
      confirmedOutsideContext?: boolean;
      confirmedPermission?: boolean;
    }
  ) {
    const shiftId = shift.id;
    if (busyShiftId === shiftId) {
      return;
    }

    const clientEventId = uuidv4();
    const location = await getCurrentLocation();
    const approverUserId = approverByShift[shiftId] || shift.manager_user_id || null;
    const payload = {
      shift_id: shiftId,
      shoot_id: shift.shoot_id ?? null,
      direction,
      client_timestamp: new Date().toISOString(),
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
      accuracy_meters: location?.accuracy ?? null,
      client_event_id: clientEventId,
      attested_approved: Boolean(attestedApprovedByShift[shiftId]),
      approver_user_id: approverUserId,
      reason_code: reasonByShift[shiftId] || null,
      notes: notesByShift[shiftId] || null,
      source: "mobile_app",
      work_state: options?.workState ?? null,
      confirmed_outside_context: options?.confirmedOutsideContext ?? false,
      confirmed_permission: options?.confirmedPermission ?? false
    };

    setBusyShiftId(shiftId);
    setShiftMessage(shiftId, direction === "in" ? "Submitting clock-in..." : "Submitting clock-out...");

    try {
      const state = await NetInfo.fetch();
      if (!state.isConnected) {
        enqueueOfflineRequest({
          id: clientEventId,
          shootId: shift.shoot_id ?? null,
          path: "/api/attendance/punches",
          method: "POST",
          headers: {
            "Idempotency-Key": clientEventId
          },
          payload
        });
        refreshQueueState();
        setShiftMessage(
          shiftId,
          `${direction === "in" ? "Clock-in" : "Clock-out"} queued offline. It will sync automatically when the connection returns.`
        );
        return;
      }

      const response = await mobileFetch<PunchResponse>("/api/attendance/punches", getToken(), {
        method: "POST",
        headers: {
          "Idempotency-Key": clientEventId
        },
        body: JSON.stringify(payload)
      });

      setShiftMessage(shiftId, buildPunchFeedbackMessage(direction, response, Boolean(location)));
      await loadSchedule();
      await runTimeClockLocationCheck();
    } catch (error) {
      const fallback = direction === "in" ? "We couldn't record that clock-in." : "We couldn't record that clock-out.";
      setShiftMessage(shiftId, humanizeMobileError(error, fallback));
    } finally {
      setBusyShiftId("");
    }
  }

  async function submitEndOfDayConfirmation(
    shift: ShiftRecord,
    decision: "returning_to_studio" | "done_for_day" | "correction_needed"
  ) {
    const sessionId = shift.time_clock_state?.session_id ?? null;
    if (!sessionId) {
      setShiftMessage(shift.id, "There is no Time Session waiting for confirmation.");
      return;
    }

    await runShiftAction(shift.id, "Updating end-of-day status...", async () => {
      const response = await mobileFetch<{ exception_request_id?: string | null }>("/api/attendance/time-clock/end-of-day-confirmation", getToken(), {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          decision,
          captured_at: new Date().toISOString(),
          note: endOfDayNote.trim() || null
        })
      });
      setEndOfDayShift(null);
      setEndOfDayNote("");
      await loadSchedule();
      return decision === "returning_to_studio"
        ? "Office/Drive restarted for the return to studio."
        : decision === "done_for_day"
          ? "Marked Off Clock for the rest of the day."
          : response.exception_request_id
            ? "Correction request created and the Time Session was closed."
            : "Correction request submitted.";
    });
  }

  async function submitRunningLate(shift: ShiftRecord) {
    await runShiftAction(shift.id, "Sending late notice...", async () => {
      await mobileFetch(`/api/attendance/shifts/${shift.id}/running-late`, getToken(), {
        method: "POST",
        body: JSON.stringify({
          notes: notesByShift[shift.id] || "Running late from the mobile app.",
          requested_approver_user_id: approverByShift[shift.id] || shift.manager_user_id || null
        })
      });
      return "Manager chain notified that you're running late.";
    });
  }

  async function submitCorrection(shift: ShiftRecord) {
    await runShiftAction(shift.id, "Submitting correction...", async () => {
      const correctionType = correctionTypeByShift[shift.id] || "FORGOT_TO_CLOCK_IN";
      const location = await getCurrentLocation();
      if (correctionType === "FORGOT_TO_CLOCK_IN" || correctionType === "FORGOT_TO_CLOCK_OUT") {
        await mobileFetch("/api/attendance/missed-punches", getToken(), {
          method: "POST",
          body: JSON.stringify({
            shift_id: shift.id,
            missing_direction: correctionType === "FORGOT_TO_CLOCK_IN" ? "in" : "out",
            employee_submitted_explanation: notesByShift[shift.id] || "Submitted from the mobile app.",
            requested_approver_user_id: approverByShift[shift.id] || shift.manager_user_id || null,
            requested_work_state: correctionWorkStateByShift[shift.id] ?? getRecommendedClockInWorkState(shift),
            requested_start_time: correctionStartByShift[shift.id] || shift.starts_at,
            requested_end_time: correctionEndByShift[shift.id] || null,
            corrected_time:
              correctionType === "FORGOT_TO_CLOCK_IN"
                ? correctionStartByShift[shift.id] || shift.starts_at
                : correctionEndByShift[shift.id] || shift.ends_at,
            location_context: location
              ? {
                  latitude: location.latitude,
                  longitude: location.longitude,
                  accuracy_meters: location.accuracy ?? null
                }
              : null
          })
        });
      } else {
        await mobileFetch("/api/attendance/exceptions", getToken(), {
          method: "POST",
          body: JSON.stringify({
            shift_id: shift.id,
            exception_type: correctionType,
            reason_code: reasonByShift[shift.id] || "other",
            notes: notesByShift[shift.id] || "Submitted from the mobile app.",
            requested_approver_user_id: approverByShift[shift.id] || shift.manager_user_id || null
          })
        });
      }
      return "Correction request submitted.";
    });
  }

  async function submitNoLunchChallenge(shift: ShiftRecord) {
    await runShiftAction(shift.id, "Submitting no-lunch challenge...", async () => {
      await mobileFetch("/api/attendance/no-lunch-challenges", getToken(), {
        method: "POST",
        body: JSON.stringify({
          shift_id: shift.id,
          reason: noLunchReasonByShift[shift.id] || "worked_through_lunch",
          note: noLunchNoteByShift[shift.id]?.trim() || null
        })
      });
      return "No Lunch Challenge submitted for Director of Photography review.";
    });
  }

  async function submitTradeRequest(shift: ShiftRecord) {
    await runShiftAction(shift.id, "Submitting trade request...", async () => {
      await mobileFetch(`/api/shifts/${shift.id}/trade-requests`, getToken(), {
        method: "POST",
        body: JSON.stringify({
          requested_with_user_id: tradePartnerByShift[shift.id] || null,
          reason: notesByShift[shift.id] || "Trade requested from the mobile app."
        })
      });
      return "Trade request submitted.";
    });
  }

  async function runShiftAction(shiftId: string, pendingMessage: string, action: () => Promise<string>) {
    if (busyShiftId === shiftId) {
      return;
    }

    setBusyShiftId(shiftId);
    setShiftMessage(shiftId, pendingMessage);
    try {
      const message = await action();
      setShiftMessage(shiftId, message);
    } catch (error) {
      setShiftMessage(shiftId, humanizeMobileError(error, "We couldn't finish that request."));
    } finally {
      setBusyShiftId("");
    }
  }

  function openUploadComposer(shift: ShiftRecord, target: UploadTargetType) {
    setUploadShift(shift);
    setUploadTarget(target);
  }

  function openPostShootEvaluation(shift: ShiftRecord) {
    setEvaluationShift(shift);
  }

  function openGearScan(shift: ShiftRecord) {
    setGearShift(shift);
  }

  function openWorkflowModal(kind: FieldWorkflowKind, shift: ShiftRecord | null) {
    setWorkflowModal({ kind, shift });
  }

  function openClockInWorkflow(shift: ShiftRecord) {
    setClockInShift(shift);
    setClockInWorkState(getRecommendedClockInWorkState(shift));
  }

  function openEndOfDayWorkflow(shift: ShiftRecord) {
    setEndOfDayShift(shift);
    setEndOfDayNote("");
  }

  function handlePrimaryAction(shift: ShiftRecord, workflowState: ShiftWorkflowState) {
    if (workflowState.primaryActionKind === "clock_in") {
      openClockInWorkflow(shift);
      return;
    }
    if (workflowState.primaryActionKind === "clock_out") {
      void submitPunch(shift, "out");
      return;
    }
    if (workflowState.primaryActionKind === "confirm_end_of_day") {
      openEndOfDayWorkflow(shift);
      return;
    }
    void submitCorrection(shift);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={panelStyle}>
          <Text style={{ fontSize: 28, fontWeight: "800", marginBottom: 8 }}>Today's Shifts</Text>
          <Text style={mutedText}>{isOnline ? "Online and ready to sync" : "Offline mode active"}</Text>
          <Text style={mutedText}>{queueCount} queued update{queueCount === 1 ? "" : "s"} waiting on this device</Text>
          <Text style={mutedText}>Allow location while using the app when you clock in or out. If GPS is unavailable, the punch can still go through and may be flagged for review.</Text>
          {isSyncing ? <ActivityIndicator style={{ marginTop: 8 }} /> : null}
          <ActionButton label={isSyncing ? "Syncing..." : "Sync Offline Queue"} disabled={isSyncing} onPress={() => void runSync("Manual sync")} />
          {syncMessage ? <Text style={infoText}>{syncMessage}</Text> : null}
        </View>

        <View style={panelStyle}>
          <Text style={sectionTitle}>Schedule Search</Text>
          <TextInput
            value={filterText}
            onChangeText={setFilterText}
            placeholder="Filter by shoot code, title, or location"
            placeholderTextColor="#7b8794"
            style={inputStyle}
          />
          <Text style={mutedText}>{visibleShifts.length} matching shift{visibleShifts.length === 1 ? "" : "s"}</Text>
        </View>

        {screenError ? (
          <View style={panelStyle}>
            <Text style={errorText}>{screenError}</Text>
            <ActionButton label="Retry Loading Shifts" onPress={() => void loadSchedule()} variant="secondary" />
          </View>
        ) : null}
        {isLoading ? (
          <View style={panelStyle}>
            <ActivityIndicator size="large" style={{ marginTop: 8 }} />
            <Text style={mutedText}>Loading today's shifts and attendance details...</Text>
          </View>
        ) : null}

        {!isLoading && !visibleShifts.length ? (
          <View style={panelStyle}>
            <Text style={sectionTitle}>Nothing scheduled yet</Text>
            <Text style={mutedText}>Published shifts for today will appear here, along with trade, correction, and punch actions.</Text>
          </View>
        ) : null}

        {visibleShifts.map((shift) => {
          const isBusy = busyShiftId === shift.id;
          const coworkers = (shift.coworkers ?? []).filter((coworker) => coworker.id !== shift.assigned_user_id);
          const workflowState = getShiftWorkflowState(shift);
          const selectedCorrectionType = correctionTypeByShift[shift.id] ?? CORRECTION_TYPES[0].value;
          const correctionWorkState = correctionWorkStateByShift[shift.id] ?? getRecommendedClockInWorkState(shift);
          const correctionStart = correctionStartByShift[shift.id] ?? shift.starts_at;
          const correctionEnd = correctionEndByShift[shift.id] ?? shift.ends_at;
          const missedPunchCorrection = selectedCorrectionType === "FORGOT_TO_CLOCK_IN" || selectedCorrectionType === "FORGOT_TO_CLOCK_OUT";
          const hasOpenNoLunchChallenge = Boolean(
            shift.exceptions?.some((exception) => exception.exception_type === "NO_LUNCH_CHALLENGE" && exception.status === "open")
          );
          const canChallengeNoLunch =
            Number(shift.payroll_summary?.gross_minutes ?? 0) > 300 ||
            Boolean(shift.payroll_summary?.break_deduction_applied) ||
            hasOpenNoLunchChallenge;

          return (
            <View key={shift.id} style={panelStyle}>
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 24, fontWeight: "800" }}>{shift.shoot_code ?? shift.title}</Text>
                {shift.shoot_title && shift.shoot_title !== shift.title ? <Text style={mutedText}>{shift.shoot_title}</Text> : null}
                <Text style={mutedText}>
                  {formatWindow(shift.starts_at, shift.ends_at)} | {shift.location_name}
                </Text>
                {shift.location_address ? <Text style={mutedText}>{shift.location_address}</Text> : null}
                <Text style={mutedText}>
                  {humanizeCode(shift.shift_kind)} | {humanizeCode(shift.status)}
                  {shift.manager_name ? ` | Manager: ${shift.manager_name}` : ""}
                </Text>
              </View>

              <View style={pillRow}>
                <InfoPill label={`Latest punch: ${getLatestPunchLabel(shift.punches)}`} />
                {shift.time_clock_state ? <InfoPill label={`Time Session: ${humanizeTimeClockState(shift.time_clock_state)}`} tone={shift.time_clock_state.current_segment_review_status === "pending_review" ? "warning" : "neutral"} /> : null}
                {shift.exceptions?.length ? <InfoPill label={`${shift.exceptions.length} open item${shift.exceptions.length === 1 ? "" : "s"}`} tone="warning" /> : null}
              </View>

              <View style={statusCardStyle(workflowState.isClockedIn ? "active" : workflowState.hasPunchHistory ? "complete" : "ready")}>
                <Text style={fieldLabel}>Current Time Clock</Text>
                <Text style={{ fontSize: 20, fontWeight: "800", color: "#102237" }}>{workflowState.statusTitle}</Text>
                <Text style={mutedText}>{workflowState.statusDetail}</Text>
                <Text style={mutedText}>{workflowState.workflowHint}</Text>
                {workflowState.reviewNote ? <Text style={infoText}>{workflowState.reviewNote}</Text> : null}
              </View>

              {shift.payroll_summary ? (
                <View style={panelInsetStyle}>
                  <Text style={fieldLabel}>Payroll Summary</Text>
                  <Text style={mutedText}>
                    Gross {formatMinutesAsHours(shift.payroll_summary.gross_minutes)} | Break {formatMinutesAsHours(shift.payroll_summary.break_deduction_minutes)} | Paid{" "}
                    {formatMinutesAsHours(shift.payroll_summary.approved_payable_minutes)}
                  </Text>
                  <Text style={mutedText}>
                    {humanizeCode(shift.payroll_summary.payroll_state ?? "pending")} | {shift.payroll_summary.break_deduction_overridden ? "Manual break override applied" : "Automatic company break policy applied when needed"}
                  </Text>
                </View>
              ) : null}

              {coworkers.length ? (
                <View style={{ gap: 6 }}>
                  <Text style={sectionTitle}>Coworkers on this shoot</Text>
                  {coworkers.map((coworker) => (
                    <Text key={coworker.id} style={mutedText}>
                      {coworker.full_name} ({coworker.roles.join(", ")})
                    </Text>
                  ))}
                </View>
              ) : null}

              {shift.segments.length ? (
                <View style={{ gap: 8 }}>
                  <Text style={sectionTitle}>Scheduled Time Segments</Text>
                  {shift.segments.map((segment) => (
                    <View key={segment.id} style={segmentCardStyle(false)}>
                      <Text style={{ fontWeight: "700", fontSize: 16 }}>{segment.label}</Text>
                      <Text style={mutedText}>
                        {segment.segment_kind} | {segment.rate_code} | ${(segment.hourly_rate_cents / 100).toFixed(2)}/hr
                      </Text>
                      <Text style={mutedText}>
                        {new Date(segment.scheduled_start_at).toLocaleTimeString()} - {new Date(segment.scheduled_end_at).toLocaleTimeString()}
                      </Text>
                    </View>
                  ))}
                  <Text style={mutedText}>Mission Control now transitions between Office/Drive and Photography automatically when location rules are met.</Text>
                </View>
              ) : null}

              <View style={actionRow}>
                <ActionButton
                  label={isBusy ? "Working..." : workflowState.primaryActionLabel}
                  disabled={isBusy}
                  onPress={() => handlePrimaryAction(shift, workflowState)}
                />
                <ActionButton label="Open Navigation" disabled={!shift.navigation_url} onPress={() => void openNavigation(shift.navigation_url)} variant="secondary" />
              </View>

              <View style={actionRow}>
                <ActionButton label="Time / Correction Form" disabled={isBusy} onPress={() => openWorkflowModal("attendance_time_correction_request", shift)} variant="secondary" />
                <ActionButton label="Staffing Help" disabled={isBusy} onPress={() => openWorkflowModal("staffing_help_request", shift)} variant="secondary" />
              </View>

              <View style={panelInsetStyle}>
                <Text style={fieldLabel}>Field Workflow Tools</Text>
                <Text style={mutedText}>Use the mobile-first forms for briefings, issue reporting, staffing help, memory suggestions, and directory updates.</Text>
                <View style={actionRow}>
                  <ActionButton label="Briefing Ack" disabled={isBusy} onPress={() => openWorkflowModal("briefing_acknowledgement", shift)} variant="secondary" />
                  <ActionButton label="Field Issue" disabled={isBusy} onPress={() => openWorkflowModal("field_issue_report", shift)} variant="secondary" />
                </View>
                <View style={actionRow}>
                  <ActionButton label="Location Memory" disabled={isBusy} onPress={() => openWorkflowModal("location_memory_suggestion", shift)} variant="secondary" />
                  <ActionButton label="Directory Update" disabled={isBusy} onPress={() => openWorkflowModal("directory_update_suggestion", shift)} variant="secondary" />
                </View>
              </View>

              <Pressable
                onPress={() =>
                  setAdvancedReviewVisibleByShift((current) => ({
                    ...current,
                    [shift.id]: !current[shift.id]
                  }))
                }
                style={panelInsetStyle}
              >
                <Text style={fieldLabel}>Advanced Review Details</Text>
                <Text style={mutedText}>
                  {advancedReviewVisibleByShift[shift.id]
                    ? "Hide the older manual approval fields and review overrides."
                    : "Show the older manual approval fields, no-lunch challenge, and legacy trade controls."}
                </Text>
              </Pressable>

              {advancedReviewVisibleByShift[shift.id] ? (
                <>
                  <Text style={sectionTitle}>Exception & approval details</Text>
                  <Text style={mutedText}>Use these fields only when the mobile workflow forms are not enough for the review you need.</Text>

                  <LabeledInput
                    label="Approver override (optional user ID)"
                    value={approverByShift[shift.id] ?? ""}
                    hint={shift.manager_name ? `Leave blank to route this to ${shift.manager_name} automatically.` : "Leave blank to route this automatically."}
                    onChangeText={(value) => setApproverByShift((current) => ({ ...current, [shift.id]: value }))}
                  />
                  <LabeledSelect
                    label="What needs review"
                    value={reasonByShift[shift.id] ?? ""}
                    options={REASON_CODES}
                    hint="Pick the closest reason so the reviewer has the right context."
                    onChange={(value) => setReasonByShift((current) => ({ ...current, [shift.id]: value }))}
                  />
                  <LabeledInput
                    label="Notes for review"
                    value={notesByShift[shift.id] ?? ""}
                    multiline
                    hint="Add a short explanation if leadership or a senior photographer will need follow-up."
                    onChangeText={(value) => setNotesByShift((current) => ({ ...current, [shift.id]: value }))}
                  />

                  <Pressable
                    onPress={() =>
                      setAttestedApprovedByShift((current) => ({
                        ...current,
                        [shift.id]: !current[shift.id]
                      }))
                    }
                    style={checkboxRow}
                  >
                    <View style={checkboxBox(Boolean(attestedApprovedByShift[shift.id]))}>
                      {attestedApprovedByShift[shift.id] ? <Text style={{ color: "#ffffff", fontWeight: "800" }}>X</Text> : null}
                    </View>
                    <Text style={mutedText}>I already cleared an early start with my manager or senior photographer.</Text>
                  </Pressable>

                  <LabeledSelect
                    label="Correction request"
                    value={selectedCorrectionType}
                    options={CORRECTION_TYPES}
                    hint={getCorrectionHint(selectedCorrectionType, workflowState.isClockedIn)}
                    onChange={(value) => setCorrectionTypeByShift((current) => ({ ...current, [shift.id]: value }))}
                  />
                  {missedPunchCorrection ? (
                    <View style={panelInsetStyle}>
                      <Text style={fieldLabel}>Missed Clock-In Request</Text>
                      <Text style={mutedText}>Capture the requested work state and timing here so the approver is reviewing structured correction data, not just notes.</Text>
                      <LabeledSelect
                        label="Requested work state"
                        value={correctionWorkState}
                        options={[
                          { value: "office_drive", label: "Office/Drive" },
                          { value: "photography", label: "Photography" }
                        ]}
                        hint="Choose the work state that should have been active for this missed clock entry."
                        onChange={(value) =>
                          setCorrectionWorkStateByShift((current) => ({
                            ...current,
                            [shift.id]: value as "office_drive" | "photography"
                          }))
                        }
                      />
                      <LabeledInput
                        label="Requested start time"
                        value={correctionStart}
                        hint="Use the full timestamp if you need to override the scheduled start."
                        onChangeText={(value) => setCorrectionStartByShift((current) => ({ ...current, [shift.id]: value }))}
                      />
                      <LabeledInput
                        label="Requested end time"
                        value={correctionEnd}
                        hint="Leave this as the scheduled end or clear it if the approver only needs the missing opening punch."
                        onChangeText={(value) => setCorrectionEndByShift((current) => ({ ...current, [shift.id]: value }))}
                      />
                      <View style={actionRow}>
                        <ActionButton
                          label="Running Late"
                          disabled={isBusy || workflowState.hasPunchHistory}
                          onPress={() => void submitRunningLate(shift)}
                          variant="secondary"
                        />
                        <ActionButton label="Request Correction" disabled={isBusy} onPress={() => void submitCorrection(shift)} variant="secondary" />
                      </View>
                    </View>
                  ) : null}
                  <Text style={mutedText}>
                    {workflowState.hasPunchHistory
                      ? "Need to fix the existing record? Use the correction request instead of creating another punch."
                      : "Already started working but missed the opening punch? Use the correction request instead of clocking in late."}
                  </Text>
                  {canChallengeNoLunch ? (
                    <View style={panelInsetStyle}>
                      <Text style={fieldLabel}>No Lunch Challenge</Text>
                      <Text style={mutedText}>
                        If this Time Session worked through lunch, challenge the automatic 30-minute deduction here. Clock history stays intact and Director of Photography review is required.
                      </Text>
                      <LabeledSelect
                        label="Challenge reason"
                        value={noLunchReasonByShift[shift.id] ?? NO_LUNCH_CHALLENGE_REASONS[0].value}
                        options={NO_LUNCH_CHALLENGE_REASONS}
                        hint="Pick the closest reason so leadership sees the right context quickly."
                        onChange={(value) => setNoLunchReasonByShift((current) => ({ ...current, [shift.id]: value }))}
                      />
                      <LabeledInput
                        label="No-lunch note"
                        value={noLunchNoteByShift[shift.id] ?? ""}
                        multiline
                        hint="Add any extra detail that the reviewer should see."
                        onChangeText={(value) => setNoLunchNoteByShift((current) => ({ ...current, [shift.id]: value }))}
                      />
                      <ActionButton
                        label={hasOpenNoLunchChallenge ? "No Lunch Challenge Submitted" : "Challenge Auto Lunch Deduction"}
                        disabled={isBusy || hasOpenNoLunchChallenge}
                        onPress={() => void submitNoLunchChallenge(shift)}
                        variant="secondary"
                      />
                    </View>
                  ) : null}
                  <View style={panelInsetStyle}>
                    <Text style={fieldLabel}>Legacy Trade Request</Text>
                    <Text style={mutedText}>Use this older trade flow only when the staffing help request does not cover the situation.</Text>
                    <ActionButton label="Request Trade" disabled={isBusy} onPress={() => void submitTradeRequest(shift)} variant="secondary" />
                  </View>
                  <LabeledSelect
                    label="Trade partner (optional)"
                    value={tradePartnerByShift[shift.id] ?? ""}
                    options={[
                      { value: "", label: "Leadership review only" },
                      ...coworkers.map((coworker) => ({
                        value: coworker.id,
                        label: coworker.full_name
                      }))
                    ]}
                    hint="Leave blank if you just need leadership to review the trade."
                    onChange={(value) => setTradePartnerByShift((current) => ({ ...current, [shift.id]: value }))}
                  />
                </>
              ) : null}

              {shift.shoot_id ? (
                <View style={panelInsetStyle}>
                  <Text style={fieldLabel}>Operational Uploads</Text>
                  <Text style={mutedText}>
                    Capture setup photos, location references, and job documents so the next team walks in better prepared.
                  </Text>
                  {(shift.staffing_role === "senior_photographer" || shift.satisfies_lead_coverage) ? (
                    <Text style={infoText}>Senior coverage is expected to leave behind setup photo context for next year.</Text>
                  ) : null}
                  <ActionButton label="Upload Photo to Job" disabled={isBusy} onPress={() => openUploadComposer(shift, "shoot")} variant="secondary" />
                  <ActionButton label="Scan Gear" disabled={isBusy} onPress={() => openGearScan(shift)} variant="secondary" />
                  <View style={pillRow}>
                    <Pressable onPress={() => openUploadComposer(shift, "location")} style={chipStyle(false)}>
                      <Text style={{ color: "#0f4a87", fontWeight: "600" }}>Upload to Location</Text>
                    </Pressable>
                    <Pressable onPress={() => openUploadComposer(shift, "organization")} style={chipStyle(false)}>
                      <Text style={{ color: "#0f4a87", fontWeight: "600" }}>Upload to Organization</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              {shift.closeout_compliance ? (
                <View style={panelInsetStyle}>
                  <Text style={fieldLabel}>Closeout Compliance</Text>
                  <View style={pillRow}>
                    <InfoPill
                      label={
                        shift.closeout_compliance.setup_photo_required
                          ? shift.closeout_compliance.setup_photo_uploaded
                            ? "Setup Photo uploaded"
                            : "Setup Photo still needed"
                          : "Setup Photo optional"
                      }
                      tone={
                        shift.closeout_compliance.setup_photo_required && !shift.closeout_compliance.setup_photo_uploaded
                          ? "warning"
                          : "neutral"
                      }
                    />
                    <InfoPill
                      label={
                        shift.closeout_compliance.post_shoot_evaluation_required
                          ? shift.closeout_compliance.post_shoot_evaluation_submitted
                            ? "Post-Shoot Evaluation submitted"
                            : "Post-Shoot Evaluation still needed"
                          : "Post-Shoot Evaluation optional"
                      }
                      tone={
                        shift.closeout_compliance.post_shoot_evaluation_required &&
                        !shift.closeout_compliance.post_shoot_evaluation_submitted
                          ? "warning"
                          : "neutral"
                      }
                    />
                  </View>
                  {shift.closeout_compliance.setup_photo_reminder_due ? (
                    <Text style={infoText}>
                      Setup photo reminder: this senior coverage shift is past the{" "}
                      {shift.closeout_compliance.reminder_threshold_minutes}-minute mark.
                    </Text>
                  ) : null}
                  {shift.closeout_compliance.warning_message ? (
                    <Text style={infoText}>{shift.closeout_compliance.warning_message}</Text>
                  ) : null}
                  {shift.closeout_compliance.mileage_reimbursement ? (
                    <View style={{ gap: 6 }}>
                      <Text style={fieldLabel}>Mileage</Text>
                      <Text style={mutedText}>
                        {shift.closeout_compliance.mileage_reimbursement.status === "candidate" &&
                        shift.closeout_compliance.mileage_reimbursement.zone_name
                          ? `Candidate ready: ${shift.closeout_compliance.mileage_reimbursement.zone_name} for $${shift.closeout_compliance.mileage_reimbursement.reimbursement_amount ?? "0.00"}`
                          : shift.closeout_compliance.mileage_reimbursement.issue_label ??
                            (shift.closeout_compliance.mileage_reimbursement.mileage_eligible
                              ? "Mileage has not been submitted for this work date yet."
                              : "This employee is not mileage eligible.")}
                      </Text>
                    </View>
                  ) : null}
                  {shift.closeout_compliance.compliance_flags?.length ? (
                    <View style={{ gap: 6 }}>
                      <Text style={fieldLabel}>Compliance Watch</Text>
                      {shift.closeout_compliance.compliance_flags.map((flag) => (
                        <Text key={flag.id} style={flag.severity === "high" ? errorText : infoText}>
                          {flag.item_label}: {flag.message}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {shift.closeout_compliance.post_shoot_evaluation_submitted ? (
                    <Text style={mutedText}>This Post-Shoot Evaluation is already locked in for the shift.</Text>
                  ) : (
                    <ActionButton
                      label={
                        shift.closeout_compliance.post_shoot_evaluation_required
                          ? "Complete Post-Shoot Evaluation"
                          : "Add Post-Shoot Evaluation"
                      }
                      disabled={isBusy}
                      onPress={() => openPostShootEvaluation(shift)}
                      variant="secondary"
                    />
                  )}
                </View>
              ) : null}

              {shiftMessages[shift.id] ? <Text style={infoText}>{shiftMessages[shift.id]}</Text> : null}
            </View>
          );
        })}

        <View style={panelStyle}>
          <Text style={sectionTitle}>Time Off / Availability</Text>
          <Text style={mutedText}>Open the mobile-first request form to submit PTO, partial-day time away, or an availability restriction update.</Text>
          <ActionButton label="Open PTO / Availability Form" onPress={() => openWorkflowModal("pto_availability_request", null)} />
        </View>

        <View style={panelStyle}>
          <Text style={sectionTitle}>Recent Notifications</Text>
          {notifications.length ? (
            notifications.map((notification) => (
              <View key={notification.id} style={notificationCardStyle(notification.priority)}>
                <Text style={{ fontWeight: "700", fontSize: 16 }}>{notification.title}</Text>
                <Text style={mutedText}>{notification.body}</Text>
                <Text style={mutedText}>
                  {notification.channel} | {notification.status} | {new Date(notification.created_at).toLocaleString()}
                </Text>
              </View>
            ))
          ) : (
            <Text style={mutedText}>Notifications you trigger or receive will appear here.</Text>
          )}
        </View>
      </ScrollView>
      <Modal visible={Boolean(clockInShift)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setClockInShift(null)}>
        <View style={{ flex: 1, backgroundColor: "#f4f7fb" }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <View style={sheetHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 24, fontWeight: "800", color: "#102237" }}>Clock In</Text>
                <Text style={mutedText}>Pick the paid state you are starting. Mission Control will warn and flag anything outside the normal location or timing rules.</Text>
              </View>
              <Pressable onPress={() => setClockInShift(null)} style={closeButton}>
                <Text style={{ color: "#0f4a87", fontWeight: "700" }}>Close</Text>
              </Pressable>
            </View>

            {clockInShift ? (
              <View style={panelStyle}>
                <Text style={sectionTitle}>{clockInShift.shoot_code ?? clockInShift.title}</Text>
                <Text style={mutedText}>{formatWindow(clockInShift.starts_at, clockInShift.ends_at)}</Text>
                <Text style={mutedText}>{clockInShift.location_name}</Text>
              </View>
            ) : null}

            <View style={panelStyle}>
              <Text style={sectionTitle}>Select Work State</Text>
              <Pressable onPress={() => setClockInWorkState("office_drive")} style={statusOption(clockInWorkState === "office_drive")}>
                <Text style={{ fontWeight: "800", color: clockInWorkState === "office_drive" ? "#ffffff" : "#102237" }}>Office/Drive</Text>
                <Text style={{ color: clockInWorkState === "office_drive" ? "#dbeafe" : "#526276", fontSize: 13 }}>
                  Use this for studio work and paid drive time between studio and Shoots or between Shoots.
                </Text>
              </Pressable>
              <Pressable onPress={() => setClockInWorkState("photography")} style={statusOption(clockInWorkState === "photography")}>
                <Text style={{ fontWeight: "800", color: clockInWorkState === "photography" ? "#ffffff" : "#102237" }}>Photography</Text>
                <Text style={{ color: clockInWorkState === "photography" ? "#dbeafe" : "#526276", fontSize: 13 }}>
                  Use this when you are on-site for the Shoot inside the normal geofence and showtime window.
                </Text>
              </Pressable>
            </View>

            <View style={panelStyle}>
              <Text style={mutedText}>If you're outside the normal context, keep the review reason and notes on the shift card accurate before continuing.</Text>
              <ActionButton
                label="Continue Clock In"
                onPress={() => {
                  if (!clockInShift) {
                    return;
                  }
                  const targetShift = clockInShift;
                  const selectedState = clockInWorkState;
                  setClockInShift(null);
                  void submitPunch(targetShift, "in", {
                    workState: selectedState,
                    confirmedOutsideContext: true,
                    confirmedPermission: true
                  });
                }}
              />
            </View>
          </ScrollView>
        </View>
      </Modal>
      <Modal visible={Boolean(endOfDayShift)} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEndOfDayShift(null)}>
        <View style={{ flex: 1, backgroundColor: "#f4f7fb" }}>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
            <View style={sheetHeader}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontSize: 24, fontWeight: "800", color: "#102237" }}>Needs End-of-Day Confirmation</Text>
                <Text style={mutedText}>Mission Control ended Photography when you left the final Shoot geofence. Confirm the paid state for the rest of the day.</Text>
              </View>
              <Pressable onPress={() => setEndOfDayShift(null)} style={closeButton}>
                <Text style={{ color: "#0f4a87", fontWeight: "700" }}>Close</Text>
              </Pressable>
            </View>

            <View style={panelStyle}>
              <TextInput
                value={endOfDayNote}
                onChangeText={setEndOfDayNote}
                placeholder="Optional note for leadership or payroll review"
                placeholderTextColor="#7b8794"
                multiline
                style={[inputStyle, { minHeight: 96, textAlignVertical: "top" }]}
              />
              <View style={{ gap: 10 }}>
                <ActionButton label="Returning to Studio" onPress={() => endOfDayShift && void submitEndOfDayConfirmation(endOfDayShift, "returning_to_studio")} />
                <ActionButton label="Done for the Day" onPress={() => endOfDayShift && void submitEndOfDayConfirmation(endOfDayShift, "done_for_day")} variant="secondary" />
                <ActionButton label="Correction Needed" onPress={() => endOfDayShift && void submitEndOfDayConfirmation(endOfDayShift, "correction_needed")} variant="secondary" />
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
      <OperationalUploadModal
        visible={Boolean(uploadShift)}
        token={getToken()}
        shift={uploadShift}
        defaultTarget={uploadTarget}
        onClose={() => setUploadShift(null)}
        onUploaded={(message) => {
          if (uploadShift) {
            setShiftMessage(uploadShift.id, message);
          }
          setUploadShift(null);
        }}
      />
      <GearQrScanModal
        visible={Boolean(gearShift)}
        token={getToken()}
        shift={gearShift}
        captureLocation={getCurrentLocation}
        onClose={() => setGearShift(null)}
        onCompleted={(message) => {
          if (gearShift) {
            setShiftMessage(gearShift.id, message);
          }
          setGearShift(null);
          void loadSchedule();
        }}
      />
      <PostShootEvaluationModal
        visible={Boolean(evaluationShift)}
        token={getToken()}
        shift={evaluationShift}
        onClose={() => setEvaluationShift(null)}
        onSubmitted={(message) => {
          if (evaluationShift) {
            setShiftMessage(evaluationShift.id, message);
          }
          setEvaluationShift(null);
          void loadSchedule();
        }}
      />
      {workflowModal ? (
        <FieldWorkflowModal
          visible={Boolean(workflowModal)}
          token={getToken()}
          workflowKind={workflowModal.kind}
          shift={workflowModal.shift}
          captureLocation={getCurrentLocation}
          onClose={() => setWorkflowModal(null)}
          onSubmitted={(message) => {
            setWorkflowModal(null);
            setSyncMessage(message);
            void loadSchedule();
          }}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

async function getCurrentLocation() {
  const navigatorLike = (globalThis as {
    navigator?: {
      geolocation?: {
        getCurrentPosition?: (
          success: (position: { coords?: { latitude: number; longitude: number; accuracy?: number | null } }) => void,
          error?: () => void,
          options?: {
            enableHighAccuracy?: boolean;
            timeout?: number;
            maximumAge?: number;
          }
        ) => void;
      };
    };
  }).navigator;
  const geolocation = navigatorLike?.geolocation;
  const getCurrentPosition = geolocation?.getCurrentPosition;
  if (!geolocation || !getCurrentPosition) {
    return null;
  }

  return await new Promise<{ latitude: number; longitude: number; accuracy: number | null } | null>((resolve) => {
    getCurrentPosition.call(
      geolocation,
      (position: {
        coords?: { latitude: number; longitude: number; accuracy?: number | null };
      }) => {
        if (!position.coords) {
          resolve(null);
          return;
        }
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  });
}

function buildSyncMessage(result: SyncOfflineQueueResult, reason?: string) {
  if (result.attempted === 0) {
    return reason ? `${reason}. No queued updates needed syncing.` : "No queued updates needed syncing.";
  }
  if (result.failed === 0) {
    return `${reason ? `${reason}. ` : ""}Synced ${result.synced} queued update${result.synced === 1 ? "" : "s"}.`;
  }
  return `${reason ? `${reason}. ` : ""}Synced ${result.synced} update${result.synced === 1 ? "" : "s"}, ${result.failed} still queued for retry.`;
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatWindow(startsAt: string, endsAt: string) {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleTimeString()} - ${end.toLocaleTimeString()}`;
  }
  return `${start.toLocaleString()} - ${end.toLocaleString()}`;
}

function formatMinutesAsHours(value: number | string | null | undefined) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) {
    return "0.00h";
  }
  return `${(numeric / 60).toFixed(2)}h`;
}

function getLatestPunchLabel(punches: ShiftPunch[]) {
  const latest = getLatestPunch(punches);
  if (!latest) {
    return "No punches yet";
  }
  return `${latest.direction === "in" ? "Clock in" : "Clock out"} at ${new Date(latest.client_timestamp).toLocaleTimeString()}`;
}

function getLatestPunch(punches: ShiftPunch[]) {
  if (!punches.length) {
    return null;
  }

  return [...punches].sort((left, right) => new Date(left.client_timestamp).getTime() - new Date(right.client_timestamp).getTime())[punches.length - 1];
}

function getRecommendedClockInWorkState(shift: ShiftRecord) {
  if (shift.shift_kind === "studio" || shift.shift_kind === "office" || shift.shift_kind === "training") {
    return "office_drive" as const;
  }
  return "photography" as const;
}

function humanizeTimeClockState(timeClockState: TimeClockStateSummary) {
  if (timeClockState.needs_end_of_day_confirmation) {
    return "Needs End-of-Day Confirmation";
  }
  if (timeClockState.current_state === "off_clock") {
    return "Off Clock";
  }
  if (timeClockState.current_state === "office_drive") {
    return "Office/Drive";
  }
  return "Photography";
}

function getShiftWorkflowState(shift: ShiftRecord): ShiftWorkflowState {
  const latestPunch = getLatestPunch(shift.punches);
  const reviewNote = latestPunch ? getPunchReviewNote(latestPunch) : null;
  const timeClockState = shift.time_clock_state ?? null;

  if (timeClockState?.needs_end_of_day_confirmation) {
    return {
      isClockedIn: false,
      hasPunchHistory: true,
      primaryDirection: "out",
      primaryActionKind: "confirm_end_of_day",
      primaryActionLabel: "Confirm End Of Day",
      statusTitle: "Needs End-of-Day Confirmation",
      statusDetail: "Photography ended at final geofence exit. Confirm whether you are returning to studio, done for the day, or need a correction.",
      workflowHint: "Mission Control will not silently assume the final drive home is paid.",
      reviewNote: timeClockState.current_segment_review_status === "pending_review" ? "This Time Segment is already flagged for leadership review." : reviewNote
    };
  }

  if (timeClockState?.current_state === "office_drive" || timeClockState?.current_state === "photography") {
    return {
      isClockedIn: true,
      hasPunchHistory: true,
      primaryDirection: "out",
      primaryActionKind: "clock_out",
      primaryActionLabel: "Clock Out",
      statusTitle: timeClockState.current_state === "office_drive" ? "Currently in Office/Drive" : "Currently in Photography",
      statusDetail: timeClockState.current_segment_started_at
        ? `${humanizeTimeClockState(timeClockState)} started at ${new Date(timeClockState.current_segment_started_at).toLocaleTimeString()}.`
        : `${humanizeTimeClockState(timeClockState)} is active.`,
      workflowHint: "Mission Control will auto-transition between Office/Drive and Photography when the location rules are met.",
      reviewNote: timeClockState.current_segment_review_status === "pending_review" ? "This Time Segment is pending review." : reviewNote
    };
  }

  if (shift.attendance_state === "no_show_suspected") {
    return {
      isClockedIn: false,
      hasPunchHistory: false,
      primaryDirection: "in",
      primaryActionKind: "request_missed_clock_in",
      primaryActionLabel: "Request Missed Clock-In",
      statusTitle: "No-show suspected",
      statusDetail: shift.attendance_state_note ?? "This shift has moved beyond the normal late window and now needs a missed-punch correction.",
      workflowHint: "Use the correction request instead of a normal clock-in so leadership can review the record cleanly.",
      reviewNote: reviewNote ?? "Leadership has likely already been alerted for this shift."
    };
  }

  if (shift.attendance_state === "missed_clock_in") {
    return {
      isClockedIn: false,
      hasPunchHistory: false,
      primaryDirection: "in",
      primaryActionKind: "request_missed_clock_in",
      primaryActionLabel: "Request Missed Clock-In",
      statusTitle: "Missed clock-in workflow required",
      statusDetail: shift.attendance_state_note ?? "This shift is past the normal late threshold for a standard clock-in.",
      workflowHint: "Submit a correction request instead of creating a new clock-in.",
      reviewNote
    };
  }

  if (shift.attendance_state === "missed_clock_out") {
    return {
      isClockedIn: false,
      hasPunchHistory: true,
      primaryDirection: "out",
      primaryActionKind: "request_missed_clock_out",
      primaryActionLabel: "Request Missed Clock-Out",
      statusTitle: "Missed clock-out needs review",
      statusDetail: shift.attendance_state_note ?? "This shift was auto-closed or still needs a corrected clock-out.",
      workflowHint: "Use the correction request so payroll can keep the original record and the approved correction together.",
      reviewNote
    };
  }

  if (!latestPunch) {
    return {
      isClockedIn: false,
      hasPunchHistory: false,
      primaryDirection: "in",
      primaryActionKind: "clock_in",
      primaryActionLabel: "Clock In",
      statusTitle: "Ready to clock in",
      statusDetail: `Scheduled for ${formatWindow(shift.starts_at, shift.ends_at)}.`,
      workflowHint: "Use the single Clock In action, then pick Office/Drive or Photography.",
      reviewNote
    };
  }

  if (latestPunch.direction === "in") {
    return {
      isClockedIn: true,
      hasPunchHistory: true,
      primaryDirection: "out",
      primaryActionKind: "clock_out",
      primaryActionLabel: "Clock Out",
      statusTitle: "Currently clocked in",
      statusDetail: `Clocked in at ${new Date(latestPunch.client_timestamp).toLocaleTimeString()}.`,
      workflowHint: "Use Clock Out when you are done. Mission Control will handle the labor-state review separately.",
      reviewNote
    };
  }

  return {
    isClockedIn: false,
    hasPunchHistory: true,
    primaryDirection: "in",
    primaryActionKind: "clock_in",
    primaryActionLabel: "Clock In Again",
    statusTitle: "Last punch was a clock-out",
    statusDetail: `Clocked out at ${new Date(latestPunch.client_timestamp).toLocaleTimeString()}.`,
    workflowHint: "If that clock-out was final, leave it as-is. If it was a mistake, send a correction request instead of adding extra punches.",
    reviewNote
  };
}

function getPunchReviewNote(punch: ShiftPunch) {
  if (punch.approval_state === "pending") {
    return "This punch is waiting for manager review.";
  }
  if (punch.geofence_status === "outside") {
    return "This punch was recorded outside the expected location and may need follow-up.";
  }
  if (punch.geofence_status === "unknown") {
    return "Location could not be confirmed. Keep a short note ready in case leadership follows up.";
  }
  if (punch.gps_confidence === "low_confidence") {
    return "GPS was borderline near the geofence edge, so this punch may still be reviewed.";
  }
  return null;
}

function getCorrectionHint(type: string, isClockedIn: boolean) {
  if (type === "FORGOT_TO_CLOCK_IN") {
    return isClockedIn
      ? "Use this if you already clocked in late but still need to fix your original start time."
      : "Use this if work started before you were able to record the opening punch.";
  }
  if (type === "FORGOT_TO_CLOCK_OUT") {
    return "Use this if the shift ended and the closing punch was missed.";
  }
  if (type === "WRONG_LOCATION") {
    return "Use this when the punch was right but GPS, parking-lot distance, or the mapped location needs review.";
  }
  if (type === "WRONG_SEGMENT") {
    return "Use this if the time was worked correctly but should belong to a different labor segment.";
  }
  return "Use this if the punch happened but the saved details still need a payroll or review correction.";
}

const EXCEPTION_COPY: Record<string, string> = {
  EARLY_CLOCK_IN_APPROVAL: "You clocked in a little early. The punch was recorded and sent for approval.",
  EARLY_CLOCK_IN_HIGH_PRIORITY: "You clocked in well before the shift start. The punch was recorded and leadership was notified.",
  UNSCHEDULED_PUNCH: "No published shift was found. The punch was recorded and flagged for manager review.",
  OUTSIDE_GEOFENCE_PUNCH: "You were outside the expected location. The punch was recorded and flagged for review.",
  LOW_CONFIDENCE_GPS: "GPS accuracy was low near the geofence edge. The punch was recorded and may need review.",
  LOCATION_NOT_CAPTURED_PUNCH: "Location was unavailable. The punch was recorded and routed for review."
};

function buildPunchFeedbackMessage(direction: "in" | "out", response: PunchResponse, hadLocation: boolean) {
  const actionLabel = direction === "in" ? "Clock-in" : "Clock-out";
  const details = new Set<string>();

  for (const exception of response.exceptions ?? []) {
    const message = EXCEPTION_COPY[exception.exception_type];
    if (message) {
      details.add(message);
    }
  }

  if (!hadLocation) {
    details.add("Location was unavailable. The punch was still recorded and may need review.");
  }

  if (direction === "out" && response.closeout_compliance?.warning_message) {
    details.add(response.closeout_compliance.warning_message);
  }

  for (const warning of response.time_clock_warnings ?? []) {
    if (warning.trim()) {
      details.add(warning.trim());
    }
  }

  if (!details.size) {
    return `${actionLabel} recorded.`;
  }

  return `${actionLabel} recorded. ${[...details].join(" ")}`;
}

async function openNavigation(url?: string | null) {
  if (!url) {
    return;
  }
  await Linking.openURL(url);
}

function humanizeMobileError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return fallback;
  }
  if (/network request failed/i.test(message)) {
    return "We couldn't reach Mission Control. Check your connection and try again.";
  }
  if (/401|403|forbidden|unauthorized|session/i.test(message)) {
    return "Your session changed or expired. Sign in again and try once more.";
  }
  return message;
}

function humanizeCode(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

type ActionButtonProps = {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  variant?: "primary" | "secondary";
};

function ActionButton({ label, disabled = false, onPress, variant = "primary" }: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: 14,
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: disabled
          ? "#94a3b8"
          : variant === "secondary"
            ? pressed
              ? "#d9e8fb"
              : "#ebf4ff"
            : pressed
              ? "#0f4a87"
              : "#166fcb",
        borderWidth: variant === "secondary" ? 1 : 0,
        borderColor: "#166fcb",
        alignItems: "center",
        justifyContent: "center"
      })}
    >
      <Text style={{ color: variant === "secondary" ? "#0f4a87" : "#ffffff", fontSize: 17, fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function LabeledInput({
  label,
  value,
  onChangeText,
  multiline = false,
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
      {hint ? <Text style={mutedText}>{hint}</Text> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        placeholderTextColor="#7b8794"
        style={[inputStyle, multiline ? { minHeight: 92, textAlignVertical: "top" } : null]}
      />
    </View>
  );
}

function LabeledSelect({
  label,
  value,
  options,
  onChange,
  hint
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={fieldLabel}>{label}</Text>
      {hint ? <Text style={mutedText}>{hint}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable key={`${label}-${option.value}`} onPress={() => onChange(option.value)} style={chipStyle(selected)}>
              <Text style={{ color: selected ? "#ffffff" : "#0f4a87", fontWeight: "600" }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function InfoPill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warning" }) {
  return (
    <View
      style={{
        borderRadius: 999,
        paddingVertical: 6,
        paddingHorizontal: 12,
        backgroundColor: tone === "warning" ? "#fef3c7" : "#e9eff7"
      }}
    >
      <Text style={{ color: tone === "warning" ? "#92400e" : "#274060", fontWeight: "700" }}>{label}</Text>
    </View>
  );
}

const sheetHeader = {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 12
} as const;

const closeButton = {
  borderWidth: 1,
  borderColor: "#bfdbfe",
  borderRadius: 999,
  paddingVertical: 8,
  paddingHorizontal: 14,
  backgroundColor: "#ffffff"
} as const;

const statusOption = (selected: boolean) =>
  ({
    borderWidth: 1,
    borderColor: selected ? "#166fcb" : "#d0d8e2",
    borderRadius: 16,
    backgroundColor: selected ? "#166fcb" : "#f8fafc",
    padding: 14,
    gap: 6
  }) as const;

const panelStyle = {
  borderWidth: 1,
  borderColor: "#d0d8e2",
  borderRadius: 18,
  backgroundColor: "#ffffff",
  padding: 18,
  gap: 12
} as const;

const panelInsetStyle = {
  borderWidth: 1,
  borderColor: "#dbe5f0",
  borderRadius: 14,
  backgroundColor: "#f8fafc",
  padding: 14,
  gap: 8
} as const;

const statusCardStyle = (tone: "ready" | "active" | "complete") =>
  ({
    borderWidth: 1,
    borderColor: tone === "active" ? "#166fcb" : tone === "complete" ? "#94a3b8" : "#d0d8e2",
    borderRadius: 16,
    backgroundColor: tone === "active" ? "#eff6ff" : tone === "complete" ? "#f8fafc" : "#ffffff",
    padding: 14,
    gap: 6
  }) as const;

const segmentCardStyle = (active: boolean) =>
  ({
    borderWidth: 1,
    borderColor: active ? "#166fcb" : "#d0d8e2",
    borderRadius: 14,
    backgroundColor: active ? "#eff6ff" : "#f8fafc",
    padding: 14,
    gap: 6
  }) as const;

const notificationCardStyle = (priority: string) =>
  ({
    borderWidth: 1,
    borderColor: priority === "critical" ? "#f59e0b" : "#d0d8e2",
    borderRadius: 14,
    backgroundColor: priority === "critical" ? "#fff7ed" : "#f8fafc",
    padding: 14,
    gap: 4
  }) as const;

const actionRow = {
  flexDirection: "row",
  gap: 10
} as const;

const pillRow = {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8
} as const;

const inputStyle = {
  borderWidth: 1,
  borderColor: "#d0d8e2",
  borderRadius: 14,
  paddingVertical: 12,
  paddingHorizontal: 14,
  color: "#102237",
  backgroundColor: "#f8fafc"
} as const;

const fieldLabel = {
  fontSize: 13,
  fontWeight: "700",
  color: "#274060",
  textTransform: "uppercase"
} as const;

const sectionTitle = {
  fontSize: 18,
  fontWeight: "700",
  color: "#102237"
} as const;

const mutedText = {
  color: "#4b5d73",
  fontSize: 15
} as const;

const infoText = {
  color: "#0f4a87",
  fontSize: 14
} as const;

const errorText = {
  color: "#b42318",
  fontSize: 14,
  fontWeight: "600"
} as const;

const checkboxRow = {
  flexDirection: "row",
  gap: 12,
  alignItems: "center"
} as const;

const checkboxBox = (selected: boolean) =>
  ({
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: selected ? "#166fcb" : "#94a3b8",
    backgroundColor: selected ? "#166fcb" : "#ffffff",
    alignItems: "center",
    justifyContent: "center"
  }) as const;

const chipStyle = (selected: boolean) =>
  ({
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#166fcb",
    backgroundColor: selected ? "#166fcb" : "#ffffff",
    paddingVertical: 10,
    paddingHorizontal: 14
  }) as const;
