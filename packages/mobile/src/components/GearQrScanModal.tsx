import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import type { ShiftRecord } from "../screens/Shoot";
import {
  checkOutGearByQr,
  completeGearPreShootVerification,
  confirmGearVerificationItem,
  humanizeGearError,
  markGearVerificationItemMissing,
  resolveGearQr,
  returnGearViaQr,
  scanGearVerificationItem,
  startGearPreShootVerification,
  type GearCheckoutSummary,
  type GearKitMembershipItem,
  type GearResolvedTarget,
  type GearVerificationBundle
} from "../gearApi";

type Props = {
  visible: boolean;
  token: string;
  shift: ShiftRecord | null;
  onClose: () => void;
  onCompleted: (message: string) => void;
  captureLocation: () => Promise<{ latitude: number; longitude: number; accuracy: number | null } | null>;
};

type ScanMode = "idle" | "resolve_target" | "verification_item";

const ISSUE_OPTIONS = [
  { value: "", label: "No issue" },
  { value: "broken", label: "Broken" },
  { value: "damage", label: "Damage" },
  { value: "missing", label: "Missing" },
  { value: "missing_part", label: "Missing part" },
  { value: "not_working", label: "Not working" },
  { value: "tile_inactive", label: "Tile inactive" },
  { value: "needs_repair", label: "Needs repair" },
  { value: "tracker_issue", label: "Tracker issue" },
  { value: "battery_issue", label: "Battery issue" },
  { value: "routine_service", label: "Routine service" },
  { value: "cleaning", label: "Cleaning" },
  { value: "other", label: "Other" }
];

export function GearQrScanModal({ visible, token, shift, onClose, onCompleted, captureLocation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanMode, setScanMode] = useState<ScanMode>("idle");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [resolvedTarget, setResolvedTarget] = useState<GearResolvedTarget | null>(null);
  const [activeCheckout, setActiveCheckout] = useState<GearCheckoutSummary | null>(null);
  const [kitMembership, setKitMembership] = useState<GearKitMembershipItem[]>([]);
  const [verification, setVerification] = useState<GearVerificationBundle | null>(null);
  const [pendingMismatchQrCode, setPendingMismatchQrCode] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [pickupWorkingOrderConfirmed, setPickupWorkingOrderConfirmed] = useState(true);
  const [pickupIssueType, setPickupIssueType] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [workingOrderConfirmed, setWorkingOrderConfirmed] = useState(true);
  const [returnIssueType, setReturnIssueType] = useState("");
  const [returnNote, setReturnNote] = useState("");
  const [scannerHint, setScannerHint] = useState("Scan a Kit or Asset QR code.");
  const scanLockRef = useRef<string>("");

  useEffect(() => {
    if (!visible) {
      return;
    }

    setScanMode("idle");
    setBusy(false);
    setNotice("");
    setError("");
    setResolvedTarget(null);
    setActiveCheckout(null);
    setKitMembership([]);
    setVerification(null);
    setPendingMismatchQrCode("");
    setOverrideReason("");
    setPickupWorkingOrderConfirmed(true);
    setPickupIssueType("");
    setPickupNote("");
    setWorkingOrderConfirmed(true);
    setReturnIssueType("");
    setReturnNote("");
    setScannerHint("Scan a Kit or Asset QR code.");
    scanLockRef.current = "";
  }, [visible, shift]);

  if (!visible) {
    return null;
  }

  async function startScanner(mode: ScanMode) {
    if (mode === "idle") {
      setScanMode("idle");
      return;
    }

    const nextPermission = permission?.granted ? permission : await requestPermission();
    if (!nextPermission.granted) {
      setError("Camera permission is required to scan gear QR codes.");
      return;
    }

    setError("");
    setNotice("");
    setScannerHint(mode === "resolve_target" ? "Scan a Kit or Asset QR code." : "Scan the next Asset in this Kit.");
    setScanMode(mode);
  }

  async function handleBarcodeScanned(result: BarcodeScanningResult) {
    if (busy || scanMode === "idle") {
      return;
    }
    if (!result.data || scanLockRef.current === result.data) {
      return;
    }
    scanLockRef.current = result.data;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      const location = await captureLocation();
      if (scanMode === "resolve_target") {
        const payload = await resolveGearQr(token, {
          qrCodeId: result.data,
          linkedShootId: shift?.shoot_id ?? null,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null
        });

        if (payload.status === "not_found") {
          setResolvedTarget(null);
          setActiveCheckout(null);
          setKitMembership([]);
          setVerification(null);
          setError(payload.warning);
        } else {
          setResolvedTarget(payload.target);
          setActiveCheckout(payload.active_checkout);
          setKitMembership(payload.kit_membership);
          setVerification(null);
          setNotice(`${payload.target.target_type === "kit" ? "Kit" : "Asset"} opened from QR scan.`);
        }
      } else if (verification) {
        const payload = await scanGearVerificationItem(token, {
          verificationId: verification.verification.id,
          qrCodeId: result.data,
          latitude: location?.latitude ?? null,
          longitude: location?.longitude ?? null
        });

        setVerification(payload.verification);
        if (payload.status === "mismatch") {
          setPendingMismatchQrCode(result.data);
          setError(payload.warning ?? "Scanned Asset does not belong to this Kit.");
        } else {
          setPendingMismatchQrCode("");
          setOverrideReason("");
          setNotice(
            payload.status === "override_applied"
              ? payload.warning ?? "Temporary Substitution logged."
              : "Kit contents confirmed from QR scan."
          );
        }
      }
    } catch (scanError) {
      setError(humanizeGearError(scanError, "We couldn't process that QR scan."));
    } finally {
      setBusy(false);
      setScanMode("idle");
      setTimeout(() => {
        scanLockRef.current = "";
      }, 750);
    }
  }

  async function handleStartVerification() {
    if (!resolvedTarget || resolvedTarget.target_type !== "kit") {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const location = await captureLocation();
      const payload = await startGearPreShootVerification(token, {
        kitId: resolvedTarget.id,
        linkedShootId: shift?.shoot_id ?? null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null
      });
      setVerification(payload);
      setNotice("Pre-Shoot Verification started.");
    } catch (startError) {
      setError(humanizeGearError(startError, "We couldn't start Pre-Shoot Verification."));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmItem(expectedAssetId: string) {
    if (!verification) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const location = await captureLocation();
      const payload = await confirmGearVerificationItem(token, {
        verificationId: verification.verification.id,
        expectedAssetId,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null
      });
      setVerification(payload);
      setNotice("Kit contents manually confirmed.");
    } catch (confirmError) {
      setError(humanizeGearError(confirmError, "We couldn't confirm that Kit item."));
    } finally {
      setBusy(false);
    }
  }

  async function handleMissingItem(expectedAssetId: string) {
    if (!verification) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const location = await captureLocation();
      const payload = await markGearVerificationItemMissing(token, {
        verificationId: verification.verification.id,
        expectedAssetId,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null
      });
      setVerification(payload);
      setNotice("Missing Kit item logged.");
    } catch (missingError) {
      setError(humanizeGearError(missingError, "We couldn't log that missing Kit item."));
    } finally {
      setBusy(false);
    }
  }

  async function handleApplyMismatchOverride() {
    if (!verification || !pendingMismatchQrCode || !overrideReason.trim()) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const location = await captureLocation();
      const payload = await scanGearVerificationItem(token, {
        verificationId: verification.verification.id,
        qrCodeId: pendingMismatchQrCode,
        overrideMismatch: true,
        overrideReason: overrideReason.trim(),
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null
      });
      setVerification(payload.verification);
      setPendingMismatchQrCode("");
      setOverrideReason("");
      setNotice(payload.warning ?? "Temporary Substitution recorded.");
    } catch (overrideError) {
      setError(humanizeGearError(overrideError, "We couldn't apply that Temporary Substitution override."));
    } finally {
      setBusy(false);
    }
  }

  async function handleCompleteVerification() {
    if (!verification) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const location = await captureLocation();
      const payload = await completeGearPreShootVerification(token, {
        verificationId: verification.verification.id,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null
      });
      setVerification(payload);
      setNotice(
        payload.verification.status === "verified_ready"
          ? "Pre-Shoot Verification completed and ready for departure."
          : "Pre-Shoot Verification completed with missing items recorded."
      );
    } catch (completeError) {
      setError(humanizeGearError(completeError, "We couldn't complete Pre-Shoot Verification."));
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckout() {
    if (!resolvedTarget || !shift?.assigned_user_id) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const location = await captureLocation();
      const payload = await checkOutGearByQr(token, {
        qrCodeId: resolvedTarget.qr_code_id ?? "",
        checkedOutToUserId: shift.assigned_user_id,
        linkedShootId: shift.shoot_id ?? null,
        verificationId: verification?.verification.id ?? null,
        pickupWorkingOrderConfirmed,
        pickupIssueType: pickupWorkingOrderConfirmed ? null : pickupIssueType || "other",
        pickupIssueNote: pickupNote.trim() || null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null
      });
      if (payload.status !== "checked_out" || !payload.checkout) {
        setError(payload.warning ?? "Mission Control could not complete this checkout.");
        return;
      }
      setActiveCheckout(payload.checkout);
      setNotice(`${resolvedTarget.label} is now Checked Out to ${shift.assigned_user_name}.`);
      onCompleted(`${resolvedTarget.label} Checked Out.`);
    } catch (checkoutError) {
      setError(humanizeGearError(checkoutError, "We couldn't check out that gear."));
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn() {
    if (!resolvedTarget || !resolvedTarget.qr_code_id) {
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const location = await captureLocation();
      const payload = await returnGearViaQr(token, {
        qrCodeId: resolvedTarget.qr_code_id,
        workingOrderConfirmed,
        issueType: workingOrderConfirmed ? null : returnIssueType || "other",
        note: returnNote.trim() || null,
        latitude: location?.latitude ?? null,
        longitude: location?.longitude ?? null
      });
      if (payload.status !== "returned") {
        setError(payload.warning ?? "Mission Control could not complete this return.");
        return;
      }
      setActiveCheckout(null);
      setNotice(payload.issue_created ? "Returned and issue logged for review." : "Returned complete and working.");
      onCompleted(`${resolvedTarget.label} returned.`);
    } catch (returnError) {
      setError(humanizeGearError(returnError, "We couldn't return that gear."));
    } finally {
      setBusy(false);
    }
  }

  const needsVerification = resolvedTarget?.target_type === "kit";
  const verificationReady = verification?.verification.status === "verified_ready" || verification?.verification.status === "verified_with_missing_items";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#f4f7fb" }}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View style={sheetHeader}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ fontSize: 24, fontWeight: "800", color: "#102237" }}>Gear QR Scan</Text>
              <Text style={mutedText}>Scan, verify, check out, and return gear without losing custody history.</Text>
            </View>
            <Pressable onPress={onClose} style={closeButton}>
              <Text style={{ color: "#0f4a87", fontWeight: "700" }}>Close</Text>
            </Pressable>
          </View>

          {shift ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Linked Shoot</Text>
              <Text style={mutedText}>{shift.shoot_title ?? shift.title}</Text>
              <Text style={mutedText}>Assigned photographer: {shift.assigned_user_name}</Text>
            </View>
          ) : null}

          {error ? <Text style={errorText}>{error}</Text> : null}
          {notice ? <Text style={infoText}>{notice}</Text> : null}

          <View style={panelStyle}>
            <Text style={sectionTitle}>Scanner</Text>
            <Text style={mutedText}>{scannerHint}</Text>
            {scanMode !== "idle" ? (
              <View style={cameraShell}>
                {!permission?.granted ? (
                  <View style={cameraFallback}>
                    <Text style={mutedText}>Camera permission is required to scan gear.</Text>
                    <MiniActionButton label="Allow Camera" onPress={() => void startScanner(scanMode)} />
                  </View>
                ) : (
                  <CameraView
                    style={{ height: 320, borderRadius: 18, overflow: "hidden" }}
                    facing="back"
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={busy ? undefined : (event) => void handleBarcodeScanned(event)}
                  />
                )}
              </View>
            ) : (
              <MiniActionButton
                label={verification ? "Scan Next Kit Item" : "Scan Kit or Asset"}
                onPress={() => void startScanner(verification ? "verification_item" : "resolve_target")}
              />
            )}
            {busy ? <ActivityIndicator /> : null}
          </View>

          {resolvedTarget ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>{resolvedTarget.target_type === "kit" ? "Kit" : "Asset"} Detail</Text>
              <Text style={{ fontWeight: "800", color: "#102237" }}>{resolvedTarget.label}</Text>
              <Text style={mutedText}>Status: {humanizeCode(resolvedTarget.status)}</Text>
              <Text style={mutedText}>Internal ID: {resolvedTarget.internal_id}</Text>
              {resolvedTarget.category ? <Text style={mutedText}>Category: {resolvedTarget.category}</Text> : null}
              {resolvedTarget.model ? <Text style={mutedText}>Model: {resolvedTarget.model}</Text> : null}
              {resolvedTarget.target_type === "kit" ? (
                <Text style={mutedText}>Kit contents: {kitMembership.length} tracked items</Text>
              ) : null}
              {activeCheckout ? (
                <View style={panelInsetStyle}>
                  <Text style={fieldLabel}>Current Custody</Text>
                  <Text style={mutedText}>
                    {activeCheckout.status === "assigned" ? "Assigned" : "Checked Out"} to {activeCheckout.checked_out_to_user_name ?? "assigned user"}
                  </Text>
                  {activeCheckout.linked_shoot_title ? <Text style={mutedText}>Linked Shoot: {activeCheckout.linked_shoot_title}</Text> : null}
                </View>
              ) : null}
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <MiniActionButton label="Rescan" onPress={() => void startScanner("resolve_target")} />
                {needsVerification && !verification ? <MiniActionButton label="Start Pre-Shoot Verification" onPress={() => void handleStartVerification()} /> : null}
                {!activeCheckout && (!needsVerification || verificationReady) ? <MiniActionButton label={`Check Out ${resolvedTarget.target_type === "kit" ? "Kit" : "Asset"}`} onPress={() => void handleCheckout()} /> : null}
              </View>
            </View>
          ) : null}

          {resolvedTarget && !activeCheckout ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Pickup Condition Check</Text>
              <View style={toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={fieldLabel}>Working Order Confirmed</Text>
                  <Text style={mutedText}>Report damage, missing parts, or inactive trackers before departure so leadership sees the issue immediately.</Text>
                </View>
                <Switch value={pickupWorkingOrderConfirmed} onValueChange={setPickupWorkingOrderConfirmed} />
              </View>
              {!pickupWorkingOrderConfirmed ? (
                <>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {ISSUE_OPTIONS.filter((option) => option.value).map((option) => {
                      const selected = option.value === pickupIssueType;
                      return (
                        <Pressable key={option.label} onPress={() => setPickupIssueType(option.value)} style={chipStyle(selected)}>
                          <Text style={{ color: selected ? "#ffffff" : "#0f4a87", fontWeight: "600" }}>{option.label}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                  <TextInput
                    value={pickupNote}
                    onChangeText={setPickupNote}
                    placeholder="Optional pickup issue note"
                    placeholderTextColor="#7b8794"
                    multiline
                    style={[inputStyle, { minHeight: 88, textAlignVertical: "top" }]}
                  />
                </>
              ) : null}
            </View>
          ) : null}

          {verification ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Pre-Shoot Verification</Text>
              <Text style={mutedText}>
                {verification.counts.present_items} present | {verification.counts.missing_items} missing | {verification.counts.pending_items} pending
              </Text>
              {verification.items.map((item) => (
                <View key={item.id} style={panelInsetStyle}>
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontWeight: "700", color: "#102237" }}>{item.expected_asset_name ?? item.scanned_asset_name ?? "Unexpected Asset"}</Text>
                    <Text style={mutedText}>
                      {item.required_in_kit ? "Required" : "Not required"} | {humanizeCode(item.presence_status)}
                      {item.expected_asset_qr_enabled ? " | QR enabled" : " | Manual confirm"}
                    </Text>
                  </View>
                  {item.note ? <Text style={infoText}>{item.note}</Text> : null}
                  {item.presence_status === "pending" && item.expected_asset_id ? (
                    <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                      <MiniActionButton label="Confirm Present" onPress={() => void handleConfirmItem(item.expected_asset_id as string)} />
                      <MiniActionButton label="Mark Missing" onPress={() => void handleMissingItem(item.expected_asset_id as string)} />
                    </View>
                  ) : null}
                </View>
              ))}
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <MiniActionButton label="Scan Next Item QR" onPress={() => void startScanner("verification_item")} />
                <MiniActionButton label="Complete Pre-Shoot Verification" onPress={() => void handleCompleteVerification()} />
              </View>
            </View>
          ) : null}

          {pendingMismatchQrCode ? (
            <View style={warningCard}>
              <Text style={{ fontWeight: "800", color: "#92400e" }}>Mismatch detected</Text>
              <Text style={mutedText}>
                The scanned Asset does not match this Kit. If leadership approves a `Temporary Substitution`, record the reason here.
              </Text>
              <TextInput
                value={overrideReason}
                onChangeText={setOverrideReason}
                placeholder="Leadership override reason"
                placeholderTextColor="#7b8794"
                multiline
                style={[inputStyle, { minHeight: 92, textAlignVertical: "top" }]}
              />
              <MiniActionButton label="Allow Temporary Substitution" onPress={() => void handleApplyMismatchOverride()} />
            </View>
          ) : null}

          {resolvedTarget && activeCheckout ? (
            <View style={panelStyle}>
              <Text style={sectionTitle}>Return Workflow</Text>
              <View style={toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text style={fieldLabel}>Working Order Confirmed</Text>
                  <Text style={mutedText}>Turn this off if anything is damaged, missing, or needs service.</Text>
                </View>
                <Switch value={workingOrderConfirmed} onValueChange={setWorkingOrderConfirmed} />
              </View>
              {!workingOrderConfirmed ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {ISSUE_OPTIONS.map((option) => {
                    const selected = option.value === returnIssueType;
                    return (
                      <Pressable key={option.label} onPress={() => setReturnIssueType(option.value)} style={chipStyle(selected)}>
                        <Text style={{ color: selected ? "#ffffff" : "#0f4a87", fontWeight: "600" }}>{option.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              ) : null}
              <TextInput
                value={returnNote}
                onChangeText={setReturnNote}
                placeholder="Optional return note"
                placeholderTextColor="#7b8794"
                multiline
                style={[inputStyle, { minHeight: 88, textAlignVertical: "top" }]}
              />
              <MiniActionButton label={`Return ${resolvedTarget.target_type === "kit" ? "Kit" : "Asset"}`} onPress={() => void handleReturn()} />
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

function MiniActionButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={miniActionButton}>
      <Text style={{ color: "#0f4a87", fontWeight: "700" }}>{label}</Text>
    </Pressable>
  );
}

function humanizeCode(value: string) {
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
  gap: 8
} as const;

const warningCard = {
  borderWidth: 1,
  borderColor: "#f59e0b",
  borderRadius: 16,
  backgroundColor: "#fff7ed",
  padding: 16,
  gap: 10
} as const;

const cameraShell = {
  borderRadius: 18,
  overflow: "hidden",
  backgroundColor: "#102237"
} as const;

const cameraFallback = {
  minHeight: 240,
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  gap: 12
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

const chipStyle = (selected: boolean) =>
  ({
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#166fcb",
    backgroundColor: selected ? "#166fcb" : "#ebf4ff",
    paddingVertical: 8,
    paddingHorizontal: 12
  }) as const;
