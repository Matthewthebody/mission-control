export const PROJECT_TRACKING_HASH = "#project-tracking";
export const PROJECT_TRACKING_WORKFLOW_HASH_PREFIX = "#project-tracking/workflows/";
export const NEEDS_ATTENTION_HASH = "#needs-attention";
export const ATTENDANCE_REVIEW_HASH = "#employees/attendance";

type WorkSpineFallbackKind =
  | "project_tracking"
  | "review"
  | "attendance"
  | "schools"
  | "sports"
  | "photography"
  | "production"
  | "my_work"
  | "directory";

type ResolveWorkSpineActionHrefInput = {
  actionHash?: string | null;
  workflowRunId?: string | null;
  fallbackHash?: string | null;
  fallbackKind?: WorkSpineFallbackKind;
};

const LEGACY_REVIEW_HASHES = new Set(["#employees/compliance", "#compliance", "#review-desk", "#production/review"]);
const ATTENDANCE_HASHES = new Set(["#operations/attendance", "#employees/attendance", "#attendance", "#time"]);
const TRUSTED_HASH_PREFIXES = [
  "#operations",
  "#employees",
  "#dashboard",
  "#my-work",
  "#my-schedule",
  "#studios",
  "#schools",
  "#sports",
  "#production",
  "#graphics",
  "#directory",
  "#accounts",
  "#approvals",
  "#notifications",
  "#tasks",
  "#jobs",
  "#reports",
  "#business-health",
  "#search"
];

const FALLBACK_HASHES: Record<WorkSpineFallbackKind, string> = {
  project_tracking: PROJECT_TRACKING_HASH,
  review: NEEDS_ATTENTION_HASH,
  attendance: ATTENDANCE_REVIEW_HASH,
  schools: "#schools",
  sports: "#sports",
  photography: "#studios",
  production: "#graphics",
  my_work: "#my-work",
  directory: "#directory"
};

function cleanHash(hash: string | null | undefined) {
  const trimmed = hash?.trim();
  return trimmed?.startsWith("#") ? trimmed : null;
}

function pathOnly(hash: string) {
  const queryIndex = hash.indexOf("?");
  const nestedHashIndex = hash.indexOf("#", 1);
  const endIndex = [queryIndex, nestedHashIndex].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  return (endIndex == null ? hash : hash.slice(0, endIndex)).toLowerCase();
}

function isTrustedExistingHash(hash: string) {
  const path = pathOnly(hash);
  return (
    isProjectTrackingWorkflowHash(hash) ||
    path === PROJECT_TRACKING_HASH ||
    path === NEEDS_ATTENTION_HASH ||
    path === ATTENDANCE_REVIEW_HASH ||
    LEGACY_REVIEW_HASHES.has(path) ||
    ATTENDANCE_HASHES.has(path) ||
    TRUSTED_HASH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
  );
}

export function isProjectTrackingWorkflowHash(hash: string | null | undefined) {
  const normalized = cleanHash(hash);
  return normalized ? /^#project-tracking\/workflows\/[^/?#]+$/i.test(normalized) : false;
}

export function buildProjectTrackingWorkflowHash(workflowRunId: string | null | undefined) {
  const id = workflowRunId?.trim();
  return id ? `${PROJECT_TRACKING_WORKFLOW_HASH_PREFIX}${encodeURIComponent(id)}` : null;
}

export function normalizeWorkSpineActionHash(hash: string | null | undefined) {
  const normalized = cleanHash(hash);
  if (!normalized || !isTrustedExistingHash(normalized)) {
    return null;
  }

  const path = pathOnly(normalized);
  if (LEGACY_REVIEW_HASHES.has(path)) {
    return NEEDS_ATTENTION_HASH;
  }
  if (ATTENDANCE_HASHES.has(path)) {
    return ATTENDANCE_REVIEW_HASH;
  }
  if (path === PROJECT_TRACKING_HASH) {
    return PROJECT_TRACKING_HASH;
  }
  return normalized;
}

export function resolveWorkSpineActionHref({
  actionHash,
  workflowRunId,
  fallbackHash,
  fallbackKind = "project_tracking"
}: ResolveWorkSpineActionHrefInput): string {
  const normalizedActionHash = normalizeWorkSpineActionHash(actionHash);
  if (normalizedActionHash && isProjectTrackingWorkflowHash(normalizedActionHash)) {
    return normalizedActionHash;
  }

  const workflowHash = buildProjectTrackingWorkflowHash(workflowRunId);
  if (workflowHash) {
    return workflowHash;
  }

  if (normalizedActionHash) {
    return normalizedActionHash;
  }

  return normalizeWorkSpineActionHash(fallbackHash) ?? FALLBACK_HASHES[fallbackKind];
}
