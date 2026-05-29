import { mobileFetch } from "./api";

export type MobileUploadSource = "mobile_camera" | "mobile_library" | "mobile_document";
export type UploadTargetType = "shoot" | "location" | "organization";
export type UploadCategory =
  | "setup_photo"
  | "location_reference"
  | "prior_successful_example"
  | "product_example"
  | "issue_concern"
  | "equipment_setup_need"
  | "qr_code_job_document"
  | "misc_internal_reference";

export type UploadIssueType = "" | "access" | "equipment" | "setup" | "timing" | "other";

export type ShiftUploadContext = {
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
  closeout_compliance?: {
    reminder_threshold_minutes: number;
    setup_photo_required: boolean;
    setup_photo_uploaded: boolean;
    setup_photo_reminder_due: boolean;
    post_shoot_evaluation_required: boolean;
    post_shoot_evaluation_submitted: boolean;
    missing_required_items: Array<"setup_photo" | "post_shoot_evaluation">;
    warning_message?: string | null;
  } | null;
  resource_library?: {
    prep_highlights: Array<{
      id: string;
      file_name: string;
      category: UploadCategory;
      is_best_reference: boolean;
    }>;
    summary: {
      total_items: number;
      pending_review_count: number;
    };
  } | null;
};

export type ManagedUploadPresign = {
  url: string;
  fields: Record<string, string>;
  storage_key: string;
  object_url: string;
};

export type MobileUploadSelection = {
  uri: string;
  fileName: string;
  contentType: string;
  fileSizeBytes: number | null;
  capturedAt: string | null;
  uploadSource: MobileUploadSource;
  gpsLat: number | null;
  gpsLng: number | null;
  previewUri: string | null;
};

export const CATEGORY_OPTIONS: Array<{ value: UploadCategory; label: string }> = [
  { value: "setup_photo", label: "Setup Photo" },
  { value: "location_reference", label: "Location Reference" },
  { value: "prior_successful_example", label: "Prior Successful Example" },
  { value: "product_example", label: "Product Example" },
  { value: "issue_concern", label: "Issue / Concern" },
  { value: "equipment_setup_need", label: "Equipment / Setup Need" },
  { value: "qr_code_job_document", label: "QR Code / Job Document" },
  { value: "misc_internal_reference", label: "Misc Internal Reference" }
];

export const ISSUE_OPTIONS: Array<{ value: UploadIssueType; label: string }> = [
  { value: "", label: "No issue flag" },
  { value: "access", label: "Access" },
  { value: "equipment", label: "Equipment" },
  { value: "setup", label: "Setup" },
  { value: "timing", label: "Timing" },
  { value: "other", label: "Other" }
];

export async function fetchShiftUploadContext(token: string, shiftId: string) {
  return mobileFetch<ShiftUploadContext>(`/api/employee/shifts/${shiftId}`, token);
}

export async function requestManagedUploadPresign(
  token: string,
  contentType: string,
  targetType: UploadTargetType,
  targetId: string
) {
  return mobileFetch<ManagedUploadPresign>("/api/uploads/presign", token, {
    method: "POST",
    body: JSON.stringify({
      content_type: contentType,
      resource_type: `resource-library-${targetType}`,
      resource_id: targetId
    })
  });
}

export async function submitResourceLibraryUpload(
  token: string,
  input: {
    shiftId?: string | null;
    targetType: UploadTargetType;
    targetId: string;
    linkedShootId?: string | null;
    presign: ManagedUploadPresign;
    selection: MobileUploadSelection;
    category: UploadCategory;
    note?: string | null;
    issueType?: UploadIssueType;
    importantForNextYear?: boolean;
  }
) {
  return mobileFetch<{
    id: string;
    approval_status: string;
    is_best_reference: boolean;
    target_label: string;
    off_clock_upload_warning?: {
      message: string;
      suggested_action: string;
    } | null;
  }>("/api/resource-library/items", token, {
    method: "POST",
    body: JSON.stringify({
      target_type: input.targetType,
      target_id: input.targetId,
      shift_id: input.shiftId ?? null,
      linked_shoot_id: input.linkedShootId ?? null,
      storage_key: input.presign.storage_key,
      file_name: input.selection.fileName,
      content_type: input.selection.contentType,
      file_size_bytes: input.selection.fileSizeBytes,
      captured_at: input.selection.capturedAt,
      category: input.category,
      note: input.note ?? null,
      issue_type: input.issueType || null,
      important_for_next_year: Boolean(input.importantForNextYear),
      upload_source: input.selection.uploadSource,
      gps_lat: input.selection.gpsLat,
      gps_lng: input.selection.gpsLng,
      url: input.presign.object_url
    })
  });
}

export async function uploadFileToManagedStorage(presign: ManagedUploadPresign, selection: MobileUploadSelection) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(presign.fields)) {
    formData.append(key, value);
  }
  formData.append(
    "file",
    {
      uri: selection.uri,
      name: selection.fileName,
      type: selection.contentType
    } as unknown as Blob
  );

  const response = await fetch(presign.url, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error("We couldn't upload that file to storage.");
  }
}

export function defaultCategoryForSelection(targetType: UploadTargetType, uploadSource: MobileUploadSource): UploadCategory {
  if (uploadSource === "mobile_document") {
    return "qr_code_job_document";
  }
  if (targetType === "location") {
    return "location_reference";
  }
  return "setup_photo";
}

export function humanizeUploadError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message) {
    return fallback;
  }
  if (/network request failed/i.test(message)) {
    return "We couldn't reach Mission Control. Check your connection and try again.";
  }
  if (/best reference/i.test(message)) {
    return message;
  }
  return message;
}

export function parseCapturedAt(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = value.includes(":") && value.includes(" ") && !value.includes("T")
    ? value.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T")
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseGps(input: Record<string, unknown> | null | undefined) {
  if (!input) {
    return { gpsLat: null, gpsLng: null };
  }
  const latitude = toNumericCoordinate(input.GPSLatitude ?? input.GPSLatitudeRef ?? input.latitude);
  const longitude = toNumericCoordinate(input.GPSLongitude ?? input.GPSLongitudeRef ?? input.longitude);
  return {
    gpsLat: latitude,
    gpsLng: longitude
  };
}

function toNumericCoordinate(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}
