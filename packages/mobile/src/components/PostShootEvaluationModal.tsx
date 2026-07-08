import { useEffect, useState } from "react";
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
import type { ShiftRecord } from "../screens/Shoot";
import {
  fetchPostShootEvaluationContext,
  humanizePostShootEvaluationError,
  respondMileageEligibility,
  submitPostShootEvaluation,
  type MileageEligibilityResponse,
  type MileageVehicleType,
  type PostShootEvaluationContext,
  type PostShootOverallStatus
} from "../postShootEvaluations";

type Props = {
  visible: boolean;
  token: string;
  shift: ShiftRecord | null;
  onClose: () => void;
  onSubmitted: (message: string) => void;
};

const STATUS_OPTIONS: Array<{ value: PostShootOverallStatus; label: string; description: string }> = [
  {
    value: "successful",
    label: "Successful",
    description: "The Shoot landed cleanly and future prep should mostly repeat what worked."
  },
  {
    value: "completed_with_issues",
    label: "Completed With Issues",
    description: "The Shoot got done, but next time needs clearer prep or watchouts."
  },
  {
    value: "significant_issue",
    label: "Significant Issue",
    description: "Leadership should expect follow-up because the day materially broke down."
  }
];

const VEHICLE_OPTIONS: Array<{ value: MileageVehicleType; label: string; description: string }> = [
  {
    value: "personal_vehicle",
    label: "Personal Vehicle",
    description: "Use this when your own vehicle should be considered for mileage reimbursement."
  },
  {
    value: "carpool_passenger",
    label: "Carpool Passenger",
    description: "Passengers do not receive mileage reimbursement."
  },
  {
    value: "company_vehicle",
    label: "Company Vehicle",
    description: "Company-vehicle use is tracked but not reimbursed as mileage."
  },
  {
    value: "other_needs_review",
    label: "Other / Needs Review",
    description: "Use this when the vehicle context needs leadership review."
  }
];

export function PostShootEvaluationModal({ visible, token, shift, onClose, onSubmitted }: Props) {
  const [context, setContext] = useState<PostShootEvaluationContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // SSA-3 post-submit mileage prompt. "hidden" until the eval persists; the answer writes to the
  // canonical model (the eval's own mileage fields + server recalc) — no local-only truth.
  const [mileagePrompt, setMileagePrompt] = useState<"hidden" | "asking" | "submitting" | "answered" | "error">("hidden");
  const [mileageAnswer, setMileageAnswer] = useState<MileageEligibilityResponse | null>(null);
  const [mileageError, setMileageError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [overallStatus, setOverallStatus] = useState<PostShootOverallStatus>("successful");
  const [wentWell, setWentWell] = useState("");
  const [rememberNextTime, setRememberNextTime] = useState("");
  const [issueFlag, setIssueFlag] = useState(false);
  const [openComment, setOpenComment] = useState("");
  const [submitForMileage, setSubmitForMileage] = useState(false);
  const [vehicleType, setVehicleType] = useState<MileageVehicleType>("personal_vehicle");

  useEffect(() => {
    if (!visible || !shift) {
      return;
    }

    setLoadingContext(true);
    setContext(null);
    setError("");
    setNotice("");
    setOverallStatus("successful");
    setWentWell("");
    setRememberNextTime("");
    setIssueFlag(false);
    setOpenComment("");
    setSubmitForMileage(false);
    setVehicleType("personal_vehicle");

    void fetchPostShootEvaluationContext(token, shift.id)
      .then((payload) => {
        setContext(payload);
        const latestEvaluation = payload.closeout_compliance?.last_post_shoot_evaluation;
        if (latestEvaluation?.overall_shoot_status) {
          setOverallStatus(latestEvaluation.overall_shoot_status);
          setWentWell(latestEvaluation.went_well ?? "");
          setRememberNextTime(latestEvaluation.remember_next_time ?? "");
          setIssueFlag(Boolean(latestEvaluation.issue_flag));
          setOpenComment(latestEvaluation.open_comment ?? "");
          setSubmitForMileage(Boolean(latestEvaluation.submit_for_mileage));
          setVehicleType(latestEvaluation.vehicle_type ?? "personal_vehicle");
        }
      })
      .catch((loadError) => {
        setError(humanizePostShootEvaluationError(loadError, "We couldn't load the Post-Shoot Evaluation context."));
      })
      .finally(() => {
        setLoadingContext(false);
      });
  }, [shift, token, visible]);

  async function handleSubmit() {
    if (!shift) {
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const payload = await submitPostShootEvaluation(token, shift.id, {
        overallShootStatus: overallStatus,
        wentWell: wentWell.trim() || null,
        rememberNextTime: rememberNextTime.trim() || null,
        issueFlag,
        openComment: openComment.trim() || null,
        submitForMileage,
        vehicleType: submitForMileage ? vehicleType : null
      });
      const message = "Post-Shoot Evaluation submitted. It is now locked for standard users.";
      setContext((current) =>
        current
          ? {
              ...current,
              closeout_compliance: payload.closeout_compliance
            }
          : current
      );
      setNotice(message);
      // SSA-3: the evaluation is now safely persisted — ask the mileage eligibility question.
      // Whatever happens to the answer call, the evaluation submission above is never affected.
      setMileagePrompt("asking");
      onSubmitted(message);
    } catch (submitError) {
      setError(humanizePostShootEvaluationError(submitError, "We couldn't submit that Post-Shoot Evaluation."));
    } finally {
      setSubmitting(false);
    }
  }

  async function answerMileageEligibility(eligible: boolean) {
    if (!shift) {
      return;
    }
    setMileagePrompt("submitting");
    setMileageError("");
    try {
      const result = await respondMileageEligibility(token, {
        shiftId: shift.id,
        eligible,
        vehicleType: eligible ? vehicleType : null
      });
      setMileageAnswer(result);
      setMileagePrompt("answered");
    } catch (answerError) {
      // The evaluation is already saved; only the mileage answer needs attention.
      setMileageError(
        humanizePostShootEvaluationError(
          answerError,
          "We couldn't record your mileage answer. Your evaluation is saved — try the mileage question again."
        )
      );
      setMileagePrompt("error");
    }
  }

  if (!visible) {
    return null;
  }

  const compliance = context?.closeout_compliance ?? null;
  const locked = Boolean(compliance?.post_shoot_evaluation_submitted);
  const submittedEvaluation = compliance?.last_post_shoot_evaluation ?? null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#f4f7fb" }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={sheetHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontSize: 24, fontWeight: "800", color: "#102237" }}>Post-Shoot Evaluation</Text>
              <Text style={mutedText}>
                Keep this short. Once submitted, standard users cannot edit it.
              </Text>
            </View>
            <Pressable onPress={onClose} style={closeButton}>
              <Text style={{ color: "#0f4a87", fontWeight: "700" }}>Close</Text>
            </Pressable>
          </View>

          {loadingContext ? (
            <View style={panelStyle}>
              <ActivityIndicator />
              <Text style={mutedText}>Loading linked Shoot context...</Text>
            </View>
          ) : null}

          {error ? <Text style={errorText}>{error}</Text> : null}
          {notice ? <Text style={infoText}>{notice}</Text> : null}

          {mileagePrompt !== "hidden" ? (
            <View style={{ gap: 8 }}>
              {mileagePrompt === "answered" && mileageAnswer ? (
                <Text style={infoText}>
                  {mileageAnswer.recorded === "eligible"
                    ? `Mileage answer recorded: eligible (${(mileageAnswer.vehicle_type ?? "personal_vehicle").replace(/_/g, " ")}). It now goes through the normal mileage review.`
                    : "Mileage answer recorded: no mileage reimbursement for this shoot."}
                </Text>
              ) : (
                <>
                  <Text style={fieldLabel}>Are you eligible for mileage reimbursement for this shoot?</Text>
                  <Text style={mutedText}>
                    Your evaluation is already saved. Answering here updates your mileage answer for this shoot.
                  </Text>
                  {mileagePrompt === "error" && mileageError ? <Text style={errorText}>{mileageError}</Text> : null}
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <Pressable
                      onPress={() => void answerMileageEligibility(true)}
                      disabled={mileagePrompt === "submitting"}
                      style={({ pressed }) => ({
                        flex: 1,
                        borderRadius: 14,
                        paddingVertical: 12,
                        alignItems: "center" as const,
                        backgroundColor: mileagePrompt === "submitting" ? "#94a3b8" : pressed ? "#0f4a87" : "#166fcb"
                      })}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 15, fontWeight: "700" }}>
                        {mileagePrompt === "submitting" ? "Saving…" : "Yes"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void answerMileageEligibility(false)}
                      disabled={mileagePrompt === "submitting"}
                      style={({ pressed }) => ({
                        flex: 1,
                        borderRadius: 14,
                        paddingVertical: 12,
                        alignItems: "center" as const,
                        borderWidth: 1,
                        borderColor: "#94a3b8",
                        backgroundColor: pressed ? "#e2e8f0" : "transparent"
                      })}
                    >
                      <Text style={{ color: "#0f172a", fontSize: 15, fontWeight: "700" }}>No</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          ) : null}

          {context ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Linked Records</Text>
              <Text style={mutedText}>
                Shoot: {context.linked_records.shoot?.shoot_code ? `${context.linked_records.shoot.shoot_code} | ` : ""}
                {context.linked_records.shoot?.title ?? shift?.title ?? "Unlinked Shoot"}
              </Text>
              {context.linked_records.organization ? (
                <Text style={mutedText}>Organization: {context.linked_records.organization.display_name}</Text>
              ) : null}
              {context.linked_records.location ? (
                <Text style={mutedText}>Location: {context.linked_records.location.name}</Text>
              ) : null}
            </View>
          ) : null}

          {compliance ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Closeout Status</Text>
              <View style={{ gap: 8 }}>
                <StatusRow
                  label="Setup Photo"
                  value={
                    compliance.setup_photo_required
                      ? compliance.setup_photo_uploaded
                        ? "Uploaded"
                        : "Still needed"
                      : "Optional"
                  }
                  tone={compliance.setup_photo_required && !compliance.setup_photo_uploaded ? "warning" : "normal"}
                />
                <StatusRow
                  label="Post-Shoot Evaluation"
                  value={
                    compliance.post_shoot_evaluation_required
                      ? compliance.post_shoot_evaluation_submitted
                        ? "Submitted"
                        : "Still needed"
                      : "Optional"
                  }
                  tone={compliance.post_shoot_evaluation_required && !compliance.post_shoot_evaluation_submitted ? "warning" : "normal"}
                />
              </View>
              {compliance.setup_photo_reminder_due ? (
                <Text style={infoText}>
                  Setup photo reminder is active because this shift is past the {compliance.reminder_threshold_minutes}-minute mark.
                </Text>
              ) : null}
              {locked && compliance.last_post_shoot_evaluation ? (
                <Text style={mutedText}>
                  Submitted {new Date(compliance.last_post_shoot_evaluation.submitted_at).toLocaleString()}.
                </Text>
              ) : null}
              {compliance.mileage_reimbursement ? (
                <View style={{ gap: 6 }}>
                  <Text style={fieldLabel}>Mileage</Text>
                  <Text style={mutedText}>
                    {compliance.mileage_reimbursement.status === "candidate" && compliance.mileage_reimbursement.zone_name
                      ? `Candidate ready: ${compliance.mileage_reimbursement.zone_name} for $${compliance.mileage_reimbursement.reimbursement_amount ?? "0.00"}`
                      : compliance.mileage_reimbursement.issue_label ??
                        (compliance.mileage_reimbursement.mileage_eligible
                          ? "Mileage has not been submitted for this work date yet."
                          : "This employee is not mileage eligible.")}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {locked ? (
            <>
              <View style={lockedCard}>
                <Text style={{ fontWeight: "800", color: "#102237" }}>This Post-Shoot Evaluation is locked</Text>
                <Text style={mutedText}>
                  Standard users cannot edit a Post-Shoot Evaluation after submission. Leadership override can come later if needed.
                </Text>
              </View>

              {submittedEvaluation ? (
                <View style={panelStyle}>
                  <Text style={sectionTitle}>Submitted Evaluation</Text>
                  <View style={{ gap: 8 }}>
                    <StatusRow
                      label="Overall Status"
                      value={STATUS_OPTIONS.find((option) => option.value === submittedEvaluation.overall_shoot_status)?.label ?? humanizeStatusValue(submittedEvaluation.overall_shoot_status)}
                      tone={submittedEvaluation.issue_flag ? "warning" : "normal"}
                    />
                    <StatusRow
                      label="Issue / Concern Flag"
                      value={submittedEvaluation.issue_flag ? "Yes" : "No"}
                      tone={submittedEvaluation.issue_flag ? "warning" : "normal"}
                    />
                    <ReadOnlyField
                      label="What Went Well"
                      value={submittedEvaluation.went_well}
                      emptyText="No success notes were saved for this Shoot."
                    />
                    <ReadOnlyField
                      label="Remember Next Time"
                      value={submittedEvaluation.remember_next_time}
                      emptyText="No recurring prep note was saved for next time."
                    />
                    <ReadOnlyField
                      label="Open Comment"
                      value={submittedEvaluation.open_comment}
                      emptyText="No additional comment was saved."
                    />
                    <ReadOnlyField
                      label="Mileage"
                      value={
                        submittedEvaluation.submit_for_mileage
                          ? VEHICLE_OPTIONS.find((option) => option.value === submittedEvaluation.vehicle_type)?.label ??
                            humanizeStatusValue(submittedEvaluation.vehicle_type ?? "")
                          : "Not submitted for mileage"
                      }
                    />
                  </View>
                  <Text style={infoText}>
                    This submission now feeds Shoot history and future Recurring Location Intelligence.
                  </Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <View style={panelStyle}>
                <Text style={sectionTitle}>Overall Shoot Status</Text>
                <View style={{ gap: 10 }}>
                  {STATUS_OPTIONS.map((option) => {
                    const selected = option.value === overallStatus;
                    return (
                      <Pressable key={option.value} onPress={() => setOverallStatus(option.value)} style={statusOption(selected)}>
                        <Text style={{ fontWeight: "800", color: selected ? "#ffffff" : "#102237" }}>{option.label}</Text>
                        <Text style={{ color: selected ? "#dbeafe" : "#526276", fontSize: 13 }}>{option.description}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={panelStyle}>
                <View style={toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={fieldLabel}>Issue / Concern Flag</Text>
                    <Text style={mutedText}>Turn this on if leadership should expect a follow-up or recurring watchout.</Text>
                  </View>
                  <Switch value={issueFlag} onValueChange={setIssueFlag} />
                </View>
                <TextInput
                  value={wentWell}
                  onChangeText={setWentWell}
                  placeholder="What went well?"
                  placeholderTextColor="#7b8794"
                  multiline
                  style={[inputStyle, { minHeight: 88, textAlignVertical: "top" }]}
                />
                <TextInput
                  value={rememberNextTime}
                  onChangeText={setRememberNextTime}
                  placeholder="What should be remembered next time?"
                  placeholderTextColor="#7b8794"
                  multiline
                  style={[inputStyle, { minHeight: 88, textAlignVertical: "top" }]}
                />
                <TextInput
                  value={openComment}
                  onChangeText={setOpenComment}
                  placeholder="Open comment"
                  placeholderTextColor="#7b8794"
                  multiline
                  style={[inputStyle, { minHeight: 110, textAlignVertical: "top" }]}
                />
              </View>

              <View style={panelStyle}>
                <View style={toggleRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={fieldLabel}>Submit For Mileage</Text>
                    <Text style={mutedText}>
                      Mileage uses studio-to-Shoot zones and only pays mileage-eligible staff using a Personal Vehicle.
                    </Text>
                  </View>
                  <Switch value={submitForMileage} onValueChange={setSubmitForMileage} />
                </View>
                <View style={{ gap: 10, opacity: submitForMileage ? 1 : 0.55 }}>
                  {VEHICLE_OPTIONS.map((option) => {
                    const selected = option.value === vehicleType;
                    return (
                      <Pressable
                        key={option.value}
                        disabled={!submitForMileage}
                        onPress={() => setVehicleType(option.value)}
                        style={statusOption(selected)}
                      >
                        <Text style={{ fontWeight: "800", color: selected ? "#ffffff" : "#102237" }}>{option.label}</Text>
                        <Text style={{ color: selected ? "#dbeafe" : "#526276", fontSize: 13 }}>{option.description}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <Pressable
                disabled={submitting}
                onPress={() => void handleSubmit()}
                style={({ pressed }) => ({
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: "center",
                  backgroundColor: submitting ? "#94a3b8" : pressed ? "#0f4a87" : "#166fcb"
                })}
              >
                <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "800" }}>
                  {submitting ? "Submitting..." : "Submit Post-Shoot Evaluation"}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: "normal" | "warning" }) {
  return (
    <View style={statusRow}>
      <Text style={fieldLabel}>{label}</Text>
      <Text style={{ color: tone === "warning" ? "#b45309" : "#102237", fontWeight: "700" }}>{value}</Text>
    </View>
  );
}

function ReadOnlyField({ label, value, emptyText }: { label: string; value: string | null | undefined; emptyText?: string }) {
  return (
    <View style={readOnlyField}>
      <Text style={fieldLabel}>{label}</Text>
      <Text style={mutedText}>{value?.trim() ? value.trim() : emptyText ?? "Not provided."}</Text>
    </View>
  );
}

function humanizeStatusValue(value: string) {
  if (!value) {
    return "Not provided";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

const sheetHeader = {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: 12
} as const;

const closeButton = {
  paddingVertical: 10,
  paddingHorizontal: 14,
  borderRadius: 999,
  backgroundColor: "#e9eff7"
} as const;

const panelStyle = {
  borderWidth: 1,
  borderColor: "#d0d8e2",
  borderRadius: 18,
  backgroundColor: "#ffffff",
  padding: 18,
  gap: 12
} as const;

const lockedCard = {
  borderWidth: 1,
  borderColor: "#166fcb",
  borderRadius: 16,
  backgroundColor: "#eff6ff",
  padding: 16,
  gap: 6
} as const;

const readOnlyField = {
  borderWidth: 1,
  borderColor: "#dbe5f0",
  borderRadius: 14,
  backgroundColor: "#f8fafc",
  padding: 14,
  gap: 6
} as const;

const toggleRow = {
  flexDirection: "row",
  gap: 12,
  alignItems: "center"
} as const;

const statusRow = {
  flexDirection: "row",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center"
} as const;

const sectionTitle = {
  fontSize: 18,
  fontWeight: "700",
  color: "#102237"
} as const;

const fieldLabel = {
  fontSize: 13,
  fontWeight: "700",
  color: "#274060",
  textTransform: "uppercase"
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
  fontWeight: "600",
  paddingHorizontal: 4
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

const statusOption = (selected: boolean) =>
  ({
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#166fcb",
    backgroundColor: selected ? "#166fcb" : "#ffffff",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4
  }) as const;
