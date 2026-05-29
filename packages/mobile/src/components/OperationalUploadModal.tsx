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
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import type { ShiftRecord } from "../screens/Shoot";
import {
  CATEGORY_OPTIONS,
  ISSUE_OPTIONS,
  defaultCategoryForSelection,
  fetchShiftUploadContext,
  humanizeUploadError,
  parseCapturedAt,
  parseGps,
  requestManagedUploadPresign,
  submitResourceLibraryUpload,
  type MobileUploadSelection,
  type MobileUploadSource,
  type ShiftUploadContext,
  type UploadCategory,
  type UploadIssueType,
  type UploadTargetType,
  uploadFileToManagedStorage
} from "../resourceUploads";

type Props = {
  visible: boolean;
  token: string;
  shift: ShiftRecord | null;
  defaultTarget: UploadTargetType;
  onClose: () => void;
  onUploaded: (message: string) => void;
};

export function OperationalUploadModal({ visible, token, shift, defaultTarget, onClose, onUploaded }: Props) {
  const [context, setContext] = useState<ShiftUploadContext | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<UploadTargetType>(defaultTarget);
  const [selection, setSelection] = useState<MobileUploadSelection | null>(null);
  const [category, setCategory] = useState<UploadCategory>("setup_photo");
  const [issueType, setIssueType] = useState<UploadIssueType>("");
  const [note, setNote] = useState("");
  const [importantForNextYear, setImportantForNextYear] = useState(false);
  const [loadingContext, setLoadingContext] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!visible || !shift) {
      return;
    }

    setSelectedTarget(defaultTarget);
    setSelection(null);
    setCategory("setup_photo");
    setIssueType("");
    setNote("");
    setImportantForNextYear(false);
    setError("");
    setNotice("");
    setLoadingContext(true);
    void fetchShiftUploadContext(token, shift.id)
      .then((payload) => {
        setContext(payload);
      })
      .catch((loadError) => {
        setError(humanizeUploadError(loadError, "We couldn't load the upload context for this shift."));
      })
      .finally(() => {
        setLoadingContext(false);
      });
  }, [defaultTarget, shift, token, visible]);

  useEffect(() => {
    if (!selection) {
      return;
    }
    setCategory(defaultCategoryForSelection(selectedTarget, selection.uploadSource));
  }, [selectedTarget, selection]);

  const availableTargets = useMemo(() => {
    if (!context) {
      return [] as Array<{ type: UploadTargetType; id: string; label: string; subtitle: string }>;
    }
    const targets: Array<{ type: UploadTargetType; id: string; label: string; subtitle: string }> = [];
    if (context.linked_records.shoot) {
      targets.push({
        type: "shoot",
        id: context.linked_records.shoot.id,
        label: "Shoot",
        subtitle: context.linked_records.shoot.shoot_code
          ? `${context.linked_records.shoot.shoot_code} | ${context.linked_records.shoot.title}`
          : context.linked_records.shoot.title
      });
    }
    if (context.linked_records.location) {
      targets.push({
        type: "location",
        id: context.linked_records.location.id,
        label: "Location",
        subtitle: context.linked_records.location.name
      });
    }
    if (context.linked_records.organization) {
      targets.push({
        type: "organization",
        id: context.linked_records.organization.id,
        label: "Organization",
        subtitle: context.linked_records.organization.display_name
      });
    }
    return targets;
  }, [context]);

  const selectedTargetRecord = availableTargets.find((target) => target.type === selectedTarget) ?? availableTargets[0] ?? null;
  const prepHighlights = context?.resource_library?.prep_highlights?.slice(0, 3) ?? [];
  const closeoutCompliance = context?.closeout_compliance ?? null;
  const seniorRequired = Boolean(context?.shift.satisfies_lead_coverage || context?.shift.staffing_role === "senior_photographer");
  const offClockAtOpen =
    shift?.time_clock_state?.current_state === "off_clock" || shift?.time_clock_state?.needs_end_of_day_confirmation;

  async function handlePickFromLibrary() {
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo library access is required to upload prep materials.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: false,
      exif: true,
      quality: 0.85
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    const gps = parseGps(asset.exif as Record<string, unknown> | undefined);
    setSelection({
      uri: asset.uri,
      fileName: asset.fileName ?? `mobile-library-${Date.now()}.jpg`,
      contentType: asset.mimeType ?? "image/jpeg",
      fileSizeBytes: asset.fileSize ?? null,
      capturedAt: parseCapturedAt((asset.exif as Record<string, unknown> | undefined)?.DateTimeOriginal ?? (asset.exif as Record<string, unknown> | undefined)?.DateTime),
      uploadSource: "mobile_library",
      gpsLat: gps.gpsLat,
      gpsLng: gps.gpsLng,
      previewUri: asset.uri
    });
  }

  async function handleCapturePhoto() {
    setError("");
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera access is required to capture a setup photo.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      exif: true,
      quality: 0.85
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    const gps = parseGps(asset.exif as Record<string, unknown> | undefined);
    setSelection({
      uri: asset.uri,
      fileName: asset.fileName ?? `mobile-camera-${Date.now()}.jpg`,
      contentType: asset.mimeType ?? "image/jpeg",
      fileSizeBytes: asset.fileSize ?? null,
      capturedAt: parseCapturedAt((asset.exif as Record<string, unknown> | undefined)?.DateTimeOriginal ?? (asset.exif as Record<string, unknown> | undefined)?.DateTime),
      uploadSource: "mobile_camera",
      gpsLat: gps.gpsLat,
      gpsLng: gps.gpsLng,
      previewUri: asset.uri
    });
  }

  async function handlePickDocument() {
    setError("");
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/jpeg", "image/png", "image/heic"],
      copyToCacheDirectory: true,
      multiple: false
    });

    if (result.canceled) {
      return;
    }

    const asset = result.assets[0];
    setSelection({
      uri: asset.uri,
      fileName: asset.name,
      contentType: asset.mimeType ?? inferContentTypeFromName(asset.name),
      fileSizeBytes: asset.size ?? null,
      capturedAt: null,
      uploadSource: "mobile_document",
      gpsLat: null,
      gpsLng: null,
      previewUri: asset.mimeType?.startsWith("image/") ? asset.uri : null
    });
  }

  async function handleSubmit() {
    if (!shift || !selectedTargetRecord || !selection) {
      setError("Choose a file before uploading.");
      return;
    }

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const presign = await requestManagedUploadPresign(token, selection.contentType, selectedTargetRecord.type, selectedTargetRecord.id);
      await uploadFileToManagedStorage(presign, selection);
      const created = await submitResourceLibraryUpload(token, {
        shiftId: shift.id,
        targetType: selectedTargetRecord.type,
        targetId: selectedTargetRecord.id,
        linkedShootId: context?.linked_records.shoot?.id ?? shift.shoot_id ?? null,
        presign,
        selection,
        category,
        note: note.trim() || null,
        issueType,
        importantForNextYear
      });
      const successParts = [
        created.approval_status === "pending_review"
          ? `Uploaded to ${created.target_label}. Leadership review is still required before it becomes prep-visible.`
          : `Uploaded to ${created.target_label}.`
      ];
      if (created.off_clock_upload_warning?.message) {
        successParts.push(created.off_clock_upload_warning.message);
      }
      if (created.off_clock_upload_warning?.suggested_action) {
        successParts.push(created.off_clock_upload_warning.suggested_action);
      }
      const successMessage = successParts.join(" ");
      setNotice(successMessage);
      onUploaded(successMessage);
      setSelection(null);
      setNote("");
      setIssueType("");
      setImportantForNextYear(false);
    } catch (submitError) {
      setError(humanizeUploadError(submitError, "We couldn't finish that upload."));
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
            <View style={{ gap: 4, flex: 1 }}>
              <Text style={{ fontSize: 24, fontWeight: "800", color: "#102237" }}>Upload Photo to Job</Text>
              <Text style={mutedText}>
                Capture setup and reference material so the next team leaves with better prep context.
              </Text>
            </View>
            <Pressable onPress={onClose} style={closeButton}>
              <Text style={{ color: "#0f4a87", fontWeight: "700" }}>Close</Text>
            </Pressable>
          </View>

          {loadingContext ? (
            <View style={panelStyle}>
              <ActivityIndicator />
              <Text style={mutedText}>Loading linked records and prep history...</Text>
            </View>
          ) : null}

          {error ? <Text style={errorText}>{error}</Text> : null}
          {notice ? <Text style={infoText}>{notice}</Text> : null}

          {seniorRequired ? (
            <View style={alertCard}>
              <Text style={{ fontWeight: "800", color: "#92400e" }}>Setup photo required</Text>
              <Text style={mutedText}>
                Senior coverage shifts are expected to leave behind setup context for next year. Uploads do not block clock-out, but leadership will be reminded if they are missing.
              </Text>
            </View>
          ) : null}

          {offClockAtOpen ? (
            <View style={alertCard}>
              <Text style={{ fontWeight: "800", color: "#92400e" }}>You are currently Off Clock</Text>
              <Text style={mutedText}>
                Mission Control will still save this upload so the operational evidence is not lost. If this happened during paid work, submit a missed clock-in or correction request after the upload.
              </Text>
            </View>
          ) : null}

          {availableTargets.length ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Attach To</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {availableTargets.map((target) => {
                  const selected = target.type === selectedTarget;
                  return (
                    <Pressable key={target.type} onPress={() => setSelectedTarget(target.type)} style={targetChip(selected)}>
                      <Text style={{ color: selected ? "#ffffff" : "#0f4a87", fontWeight: "700" }}>{target.label}</Text>
                      <Text style={{ color: selected ? "#dbeafe" : "#526276", fontSize: 12 }}>{target.subtitle}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          {context ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Linked Records</Text>
              <Text style={mutedText}>
                Shoot: {context.linked_records.shoot?.shoot_code ? `${context.linked_records.shoot.shoot_code} | ` : ""}
                {context.linked_records.shoot?.title ?? shift?.shoot_title ?? shift?.title ?? "Unlinked Shoot"}
              </Text>
              {context.linked_records.organization ? (
                <Text style={mutedText}>Organization: {context.linked_records.organization.display_name}</Text>
              ) : null}
              {context.linked_records.location ? (
                <Text style={mutedText}>Location: {context.linked_records.location.name}</Text>
              ) : null}
              {selectedTargetRecord ? (
                <Text style={mutedText}>
                  Upload target: {selectedTargetRecord.label} | {selectedTargetRecord.subtitle}
                </Text>
              ) : null}
              {closeoutCompliance?.setup_photo_required ? (
                <Text style={closeoutCompliance.setup_photo_uploaded ? infoText : mutedText}>
                  {closeoutCompliance.setup_photo_uploaded
                    ? "A Setup Photo is already on file for this Shoot."
                    : closeoutCompliance.setup_photo_reminder_due
                      ? `Setup Photo reminder is active because this shift is past the ${closeoutCompliance.reminder_threshold_minutes}-minute mark.`
                      : "A Setup Photo is still expected for this Shoot."}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={panelStyle}>
            <Text style={sectionTitle}>Metadata Captured Automatically</Text>
            <View style={{ gap: 8 }}>
              <MetadataRow label="Uploader" value={shift?.assigned_user_name ?? "Current signed-in user"} />
              <MetadataRow label="Upload Time" value="Captured when Mission Control receives the upload" />
              <MetadataRow
                label="Upload Source"
                value={selection ? humanizeUploadSource(selection.uploadSource) : "Recorded after you choose a file source"}
              />
              <MetadataRow
                label="Captured Time"
                value={selection?.capturedAt ? new Date(selection.capturedAt).toLocaleString() : "Used when available from the file"}
              />
              <MetadataRow
                label="Linked Records"
                value={buildLinkedRecordSummary(context, selectedTargetRecord?.label ?? null)}
              />
              <MetadataRow
                label="GPS"
                value={
                  selection?.gpsLat !== null && selection?.gpsLng !== null
                    ? "Saved from the selected file when available and allowed"
                    : "Captured when available and allowed"
                }
              />
            </View>
          </View>

          <View style={panelStyle}>
            <Text style={sectionTitle}>Choose File</Text>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <MiniActionButton label="Take Photo" onPress={() => void handleCapturePhoto()} />
              <MiniActionButton label="Photo Library" onPress={() => void handlePickFromLibrary()} />
              <MiniActionButton label="Document" onPress={() => void handlePickDocument()} />
            </View>
            {selection ? (
              <View style={panelInsetStyle}>
                <Text style={fieldLabel}>Selected File</Text>
                <Text style={{ fontWeight: "700", color: "#102237" }}>{selection.fileName}</Text>
                <Text style={mutedText}>
                  {selection.contentType} {selection.fileSizeBytes ? `| ${(selection.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : ""}
                </Text>
                {selection.capturedAt ? <Text style={mutedText}>Captured {new Date(selection.capturedAt).toLocaleString()}</Text> : null}
                {selection.gpsLat !== null && selection.gpsLng !== null ? <Text style={mutedText}>GPS metadata captured</Text> : null}
              </View>
            ) : (
              <Text style={mutedText}>Take a fresh setup photo, choose from the camera roll, or attach a job PDF.</Text>
            )}
          </View>

          <View style={panelStyle}>
            <Text style={sectionTitle}>Tag This Upload</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {CATEGORY_OPTIONS.map((option) => {
                const selected = option.value === category;
                return (
                  <Pressable key={option.value} onPress={() => setCategory(option.value)} style={targetChip(selected)}>
                    <Text style={{ color: selected ? "#ffffff" : "#0f4a87", fontWeight: "700" }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {ISSUE_OPTIONS.map((option) => {
                const selected = option.value === issueType;
                return (
                  <Pressable key={option.value || "none"} onPress={() => setIssueType(option.value)} style={subtleChip(selected)}>
                    <Text style={{ color: selected ? "#ffffff" : "#0f4a87", fontWeight: "600" }}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Optional note for the next team"
              placeholderTextColor="#7b8794"
              multiline
              style={[inputStyle, { minHeight: 92, textAlignVertical: "top" }]}
            />
            <View style={toggleRow}>
              <View style={{ flex: 1 }}>
                <Text style={fieldLabel}>Important for next year</Text>
                <Text style={mutedText}>Mark this as a Best Reference candidate for future prep.</Text>
              </View>
              <Switch value={importantForNextYear} onValueChange={setImportantForNextYear} />
            </View>
          </View>

          {prepHighlights.length ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Recent Prep Context</Text>
              {prepHighlights.map((item) => (
                <View key={item.id} style={panelInsetStyle}>
                  <Text style={{ fontWeight: "700", color: "#102237" }}>{item.file_name}</Text>
                  <Text style={mutedText}>
                    {CATEGORY_OPTIONS.find((option) => option.value === item.category)?.label ?? item.category}
                    {item.is_best_reference ? " | Best Reference" : ""}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <Pressable
            disabled={submitting || !selection || !selectedTargetRecord}
            onPress={() => void handleSubmit()}
            style={({ pressed }) => ({
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: "center",
              backgroundColor: !selection || !selectedTargetRecord || submitting ? "#94a3b8" : pressed ? "#0f4a87" : "#166fcb"
            })}
          >
            <Text style={{ color: "#ffffff", fontSize: 17, fontWeight: "800" }}>{submitting ? "Uploading..." : "Submit Upload"}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

function inferContentTypeFromName(fileName: string) {
  const normalized = fileName.toLowerCase();
  if (normalized.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (normalized.endsWith(".png")) {
    return "image/png";
  }
  if (normalized.endsWith(".heic")) {
    return "image/heic";
  }
  return "image/jpeg";
}

function MiniActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={miniActionButton}>
      <Text style={{ color: "#0f4a87", fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={fieldLabel}>{label}</Text>
      </View>
      <View style={{ flex: 2 }}>
        <Text style={mutedText}>{value}</Text>
      </View>
    </View>
  );
}

function buildLinkedRecordSummary(
  context: ShiftUploadContext | null,
  selectedTargetLabel: string | null
) {
  const parts = [
    context?.linked_records.shoot ? "Shoot" : null,
    context?.linked_records.organization ? "Organization" : null,
    context?.linked_records.location ? "Location" : null
  ].filter(Boolean);

  if (!parts.length) {
    return "Mission Control links the upload back to the current operational records.";
  }

  return `${parts.join(", ")}${selectedTargetLabel ? ` | primary target: ${selectedTargetLabel}` : ""}`;
}

function humanizeUploadSource(source: MobileUploadSource) {
  if (source === "mobile_camera") {
    return "Direct camera capture";
  }
  if (source === "mobile_library") {
    return "Photo library / gallery";
  }
  return "Document picker";
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

const miniActionButton = {
  borderRadius: 14,
  paddingVertical: 12,
  paddingHorizontal: 14,
  backgroundColor: "#ebf4ff",
  borderWidth: 1,
  borderColor: "#166fcb"
} as const;

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
  gap: 6
} as const;

const alertCard = {
  borderWidth: 1,
  borderColor: "#f59e0b",
  borderRadius: 16,
  backgroundColor: "#fff7ed",
  padding: 16,
  gap: 6
} as const;

const toggleRow = {
  flexDirection: "row",
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

const targetChip = (selected: boolean) =>
  ({
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#166fcb",
    backgroundColor: selected ? "#166fcb" : "#ffffff",
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 2
  }) as const;

const subtleChip = (selected: boolean) =>
  ({
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#166fcb",
    backgroundColor: selected ? "#166fcb" : "#ebf4ff",
    paddingVertical: 8,
    paddingHorizontal: 12
  }) as const;
