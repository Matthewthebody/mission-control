import type {
  JobCategory,
  JobDeliverableStatus,
  JobDepartmentType,
  ProductionBoardReleaseStatus,
  ProductionBoardWorkflowStatus
} from "../../domain/jobTruth/index.js";
import type {
  DeliverableItemRecord,
  ProductionItemRecord,
  SchoolJobProfileRecord,
  SportsJobProfileRecord
} from "../../types/jobTruth.js";

export const PRODUCTION_TEMPLATE_KEYS = [
  "schools_workflow",
  "sports_workflow",
  "specialty_workflow",
  "photos_over_time"
] as const;

export const PRODUCTION_COMPLETION_RULE_KEYS = [
  "schools_gallery_or_email",
  "sports_release_date_or_legacy_finished",
  "specialty_template_marker",
  "photos_over_time_event"
] as const;

export type ProductionTemplateKey = (typeof PRODUCTION_TEMPLATE_KEYS)[number];
export type ProductionCompletionRuleKey = (typeof PRODUCTION_COMPLETION_RULE_KEYS)[number];

export type ProductionTemplateDeliverableSeed = {
  deliverable_type: string;
  title: string;
  delivery_method: string;
  status?: JobDeliverableStatus;
  deliverable_group_key: string | null;
  completion_marker_key: string | null;
  vendor_name?: string | null;
  legacy_source_reference?: string | null;
};

export type ProductionTemplatePlan = {
  templateKey: ProductionTemplateKey;
  completionRuleKey: ProductionCompletionRuleKey;
  label: string;
  completionLabel: string;
  productionType: string;
  title: string;
  proofRequired: boolean;
  indicatorLabels: string[];
  deliverableSeeds: ProductionTemplateDeliverableSeed[];
};

export type ProductionCompletionEvaluation = {
  isCompleted: boolean;
  completedAt: string | null;
  closedAt: string | null;
  workflowStatus: ProductionBoardWorkflowStatus | null;
  releaseStatus: ProductionBoardReleaseStatus | null;
  evidence: string[];
};

export type ProductionTemplateContext = {
  departmentType: JobDepartmentType;
  jobCategory?: JobCategory | null;
  title?: string | null;
  productionType?: string | null;
  proofRequired?: boolean | null;
  vendorName?: string | null;
  releaseTarget?: string | null;
  schoolProfile?: SchoolJobProfileRecord | null;
  sportsProfile?: SportsJobProfileRecord | null;
};

type CompletionStateInput = {
  item: Pick<
    ProductionItemRecord,
    | "title"
    | "department_type"
    | "job_type"
    | "production_type"
    | "proof_required"
    | "release_target"
    | "vendor_name"
    | "workflow_status"
    | "release_status"
    | "completed_at"
    | "closed_at"
    | "imported_status_source"
  >;
  deliverables: Array<
    Pick<
      DeliverableItemRecord,
      "deliverable_type" | "title" | "status" | "deliverable_group_key" | "completion_marker_key"
    >
  >;
  plan?: ProductionTemplatePlan | null;
  now?: Date;
};

type LegacyProductionProjectSeedInput = {
  legacyId: string;
  departmentType: JobDepartmentType;
  title: string;
  jobType?: string | null;
  stage?: string | null;
  status?: string | null;
  ownerUserId?: string | null;
  peerReviewerUserId?: string | null;
  finalQcReviewerUserId?: string | null;
  dueDate?: string | null;
  completedAt?: string | null;
};

type LegacySchoolWorkSeedInput = {
  legacyId: string;
  workType: string;
  title: string;
};

type LegacySportsSpecialtySeedInput = {
  legacyId: string;
  productType: string;
  title: string;
  vendorName?: string | null;
};

const GALLERY_RELEASE_TARGETS = new Set(["gallery", "standard_gallery", "team_gallery", "portal", "admin_portal"]);
const GALLERY_COMPLETION_MARKERS = new Set(["gallery_release_event", "gallery_email_sent"]);
const SPECIALTY_HINTS = ["banner", "specialty", "print", "vendor", "poster", "memory", "trader"];
const PHOTOS_OVER_TIME_HINTS = ["photos over time", "preload", "pre-load", "pot"];
const SENT_LIKE_STATUSES = new Set<JobDeliverableStatus>(["sent", "in_transit", "delivered", "confirmed"]);
const DELIVERED_LIKE_STATUSES = new Set<JobDeliverableStatus>(["delivered", "confirmed"]);

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeTimestamp(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : value;
}

function containsHint(value: string | null | undefined, hints: string[]) {
  const normalized = normalizeText(value);
  return normalized ? hints.some((hint) => normalized.includes(hint)) : false;
}

function titlePrefix(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed?.length ? trimmed : "Production";
}

function pushSeed(target: ProductionTemplateDeliverableSeed[], seed: ProductionTemplateDeliverableSeed, seen: Set<string>) {
  const key = `${seed.deliverable_type}:${seed.deliverable_group_key ?? ""}:${seed.completion_marker_key ?? ""}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  target.push(seed);
}

export function isPhotosOverTimeTemplateContext(context: ProductionTemplateContext) {
  return containsHint(context.title, PHOTOS_OVER_TIME_HINTS) || containsHint(context.productionType, PHOTOS_OVER_TIME_HINTS);
}

export function isSpecialtyTemplateContext(context: ProductionTemplateContext) {
  const releaseTarget = normalizeText(context.releaseTarget);
  return (
    context.jobCategory === "specialty" ||
    context.jobCategory === "banner_day" ||
    containsHint(context.productionType, SPECIALTY_HINTS) ||
    Boolean(context.vendorName) ||
    Boolean(context.sportsProfile?.banner_work_required) ||
    Boolean(context.sportsProfile?.specialty_products_required) ||
    (releaseTarget != null && !GALLERY_RELEASE_TARGETS.has(releaseTarget))
  );
}

export function resolveProductionTemplateKey(context: ProductionTemplateContext): ProductionTemplateKey {
  if (isPhotosOverTimeTemplateContext(context)) {
    return "photos_over_time";
  }
  if (context.departmentType === "schools") {
    return "schools_workflow";
  }
  if (context.departmentType === "sports" && !isSpecialtyTemplateContext(context)) {
    return "sports_workflow";
  }
  return "specialty_workflow";
}

function buildSchoolsDeliverables(context: ProductionTemplateContext) {
  const seeds: ProductionTemplateDeliverableSeed[] = [];
  const seen = new Set<string>();
  const prefix = titlePrefix(context.title);
  pushSeed(seeds, {
    deliverable_type: "gallery_live",
    title: `${prefix} gallery release`,
    delivery_method: "digital",
    status: "not_started",
    deliverable_group_key: "gallery",
    completion_marker_key: "gallery_release_event"
  }, seen);
  pushSeed(seeds, {
    deliverable_type: "gallery_email_sent",
    title: `${prefix} gallery email`,
    delivery_method: "email",
    status: "not_started",
    deliverable_group_key: "gallery",
    completion_marker_key: "gallery_email_sent"
  }, seen);
  if (context.schoolProfile?.admin_portal_required) {
    pushSeed(seeds, {
      deliverable_type: "admin_portal_ready",
      title: `${prefix} admin portal ready`,
      delivery_method: "digital",
      status: "not_started",
      deliverable_group_key: "gallery",
      completion_marker_key: "admin_portal_ready"
    }, seen);
  }
  if (context.schoolProfile?.yearbook_required) {
    pushSeed(seeds, {
      deliverable_type: "yearbook_export_sent",
      title: `${prefix} yearbook export`,
      delivery_method: "digital",
      status: "not_started",
      deliverable_group_key: "yearbook",
      completion_marker_key: "yearbook_export_sent"
    }, seen);
  }
  if (context.schoolProfile?.id_cards_required) {
    pushSeed(seeds, {
      deliverable_type: "id_package_delivered",
      title: `${prefix} ID package`,
      delivery_method: "physical",
      status: "not_started",
      deliverable_group_key: "id_package",
      completion_marker_key: "id_package_delivered"
    }, seen);
  }
  if (context.schoolProfile?.composite_required) {
    pushSeed(seeds, {
      deliverable_type: "composite_delivered",
      title: `${prefix} composite delivery`,
      delivery_method: "digital",
      status: "not_started",
      deliverable_group_key: "yearbook",
      completion_marker_key: "composite_delivered"
    }, seen);
  }
  return seeds;
}

function buildSportsDeliverables(context: ProductionTemplateContext) {
  const seeds: ProductionTemplateDeliverableSeed[] = [];
  const seen = new Set<string>();
  const prefix = titlePrefix(context.title);
  pushSeed(seeds, {
    deliverable_type: "gallery_live",
    title: `${prefix} gallery release`,
    delivery_method: "digital",
    status: "not_started",
    deliverable_group_key: "gallery",
    completion_marker_key: "gallery_release_event"
  }, seen);
  if (context.proofRequired || context.sportsProfile?.proof_required) {
    pushSeed(seeds, {
      deliverable_type: "proof_packet_delivered",
      title: `${prefix} proof packet`,
      delivery_method: "digital",
      status: "not_started",
      deliverable_group_key: "proofs",
      completion_marker_key: "proof_approval"
    }, seen);
  }
  if (context.sportsProfile?.banner_work_required) {
    pushSeed(seeds, {
      deliverable_type: "banner_delivered",
      title: `${prefix} banners`,
      delivery_method: "vendor",
      status: "not_started",
      deliverable_group_key: "banners",
      completion_marker_key: "banner_delivery_confirmation"
    }, seen);
  }
  if (context.sportsProfile?.specialty_products_required) {
    pushSeed(seeds, {
      deliverable_type: "specialty_products_delivered",
      title: `${prefix} specialty products`,
      delivery_method: "vendor",
      status: "not_started",
      deliverable_group_key: "specialty_products",
      completion_marker_key: "specialty_delivery_confirmation"
    }, seen);
    pushSeed(seeds, {
      deliverable_type: "vendor_output_sent",
      title: `${prefix} vendor batch`,
      delivery_method: "vendor",
      status: "not_started",
      deliverable_group_key: "vendor",
      completion_marker_key: "vendor_submission",
      vendor_name: context.vendorName ?? null
    }, seen);
  }
  return seeds;
}

function buildSpecialtyDeliverables(context: ProductionTemplateContext) {
  const seeds: ProductionTemplateDeliverableSeed[] = [];
  const seen = new Set<string>();
  const prefix = titlePrefix(context.title);
  if (context.proofRequired) {
    pushSeed(seeds, {
      deliverable_type: "proof_packet_delivered",
      title: `${prefix} proof approval`,
      delivery_method: "digital",
      status: "not_started",
      deliverable_group_key: "proofs",
      completion_marker_key: "proof_approval"
    }, seen);
  }
  if (context.vendorName || containsHint(context.productionType, ["vendor", "print", "banner"])) {
    pushSeed(seeds, {
      deliverable_type: "vendor_print_batch_sent",
      title: `${prefix} vendor submission`,
      delivery_method: "vendor",
      status: "not_started",
      deliverable_group_key: "vendor",
      completion_marker_key: "vendor_submission",
      vendor_name: context.vendorName ?? null
    }, seen);
  }
  if (containsHint(context.productionType, ["gallery"])) {
    pushSeed(seeds, {
      deliverable_type: "gallery_live",
      title: `${prefix} gallery release`,
      delivery_method: "digital",
      status: "not_started",
      deliverable_group_key: "gallery",
      completion_marker_key: "gallery_release_event"
    }, seen);
  }
  pushSeed(seeds, {
    deliverable_type: "specialty_products_delivered",
    title: `${prefix} delivery confirmation`,
    delivery_method: context.vendorName ? "vendor" : "digital",
    status: "not_started",
    deliverable_group_key: "specialty_products",
    completion_marker_key: "specialty_delivery_confirmation",
    vendor_name: context.vendorName ?? null
  }, seen);
  pushSeed(seeds, {
    deliverable_type: "client_email_sent",
    title: `${prefix} completion email`,
    delivery_method: "email",
    status: "not_started",
    deliverable_group_key: "delivery",
    completion_marker_key: "email_sent"
  }, seen);
  return seeds;
}

function buildPhotosOverTimeDeliverables(context: ProductionTemplateContext) {
  const prefix = titlePrefix(context.title);
  return [
    {
      deliverable_type: "gallery_live",
      title: `${prefix} gallery release`,
      delivery_method: "digital",
      status: "not_started" as JobDeliverableStatus,
      deliverable_group_key: "gallery",
      completion_marker_key: "gallery_release_event"
    },
    {
      deliverable_type: "gallery_email_sent",
      title: `${prefix} gallery email`,
      delivery_method: "email",
      status: "not_started" as JobDeliverableStatus,
      deliverable_group_key: "gallery",
      completion_marker_key: "gallery_email_sent"
    },
    {
      deliverable_type: "admin_portal_ready",
      title: `${prefix} preload ready`,
      delivery_method: "digital",
      status: "not_started" as JobDeliverableStatus,
      deliverable_group_key: "gallery",
      completion_marker_key: "admin_portal_ready"
    }
  ];
}

export function buildDepartmentProductionTemplatePlan(context: ProductionTemplateContext): ProductionTemplatePlan {
  const templateKey = resolveProductionTemplateKey(context);
  const proofRequired = Boolean(context.proofRequired ?? context.sportsProfile?.proof_required ?? false);
  switch (templateKey) {
    case "schools_workflow":
      return {
        templateKey,
        completionRuleKey: "schools_gallery_or_email",
        label: "Schools Workflow",
        completionLabel: "Gallery release or email, plus school outputs",
        productionType: context.productionType ?? "schools_post_processing",
        title: `${titlePrefix(context.title)} production`,
        proofRequired,
        indicatorLabels: ["Roster/Data", "Naming & Sorting", "Gallery Ready", "ID / Yearbook"],
        deliverableSeeds: buildSchoolsDeliverables(context)
      };
    case "sports_workflow":
      return {
        templateKey,
        completionRuleKey: "sports_release_date_or_legacy_finished",
        label: "Sports Workflow",
        completionLabel: "Release date or mapped legacy finished state",
        productionType: context.productionType ?? (proofRequired ? "sports_proof_workflow" : "sports_post_processing"),
        title: `${titlePrefix(context.title)} production`,
        proofRequired,
        indicatorLabels: ["Gallery", "Multi-Deliverable", "Proof / Release", "Vendor Aware"],
        deliverableSeeds: buildSportsDeliverables(context)
      };
    case "photos_over_time":
      return {
        templateKey,
        completionRuleKey: "photos_over_time_event",
        label: "Photos Over Time",
        completionLabel: "Gallery or preload-ready completion event",
        productionType: context.productionType ?? "photos_over_time",
        title: `${titlePrefix(context.title)} production`,
        proofRequired: false,
        indicatorLabels: ["Preload", "Gallery", "Same Board"],
        deliverableSeeds: buildPhotosOverTimeDeliverables(context)
      };
    default:
      return {
        templateKey: "specialty_workflow",
        completionRuleKey: "specialty_template_marker",
        label: "Specialty Workflow",
        completionLabel: "Template-driven proof, vendor, email, or delivery completion",
        productionType: context.productionType ?? "specialty_graphics",
        title: `${titlePrefix(context.title)} production`,
        proofRequired,
        indicatorLabels: ["Specialty", "Vendor Path", "Flexible Completion"],
        deliverableSeeds: buildSpecialtyDeliverables(context)
      };
  }
}

function getMarkerMode(marker: string | null | undefined) {
  switch (marker) {
    case "gallery_email_sent":
    case "yearbook_export_sent":
    case "admin_portal_ready":
    case "email_sent":
    case "vendor_submission":
      return "sent";
    case "proof_approval":
    case "gallery_release_event":
    case "id_package_delivered":
    case "composite_delivered":
    case "banner_delivery_confirmation":
    case "specialty_delivery_confirmation":
    case "delivery_confirmation":
      return "delivered";
    default:
      return "delivered";
  }
}

function isMarkerSatisfied(
  deliverables: CompletionStateInput["deliverables"],
  marker: string,
  overrideMode?: "sent" | "delivered"
) {
  const mode = overrideMode ?? getMarkerMode(marker);
  return deliverables.some((deliverable) => {
    if (deliverable.status === "cancelled" || deliverable.status === "issue_flagged") {
      return false;
    }
    const deliverableMarker = deliverable.completion_marker_key ?? null;
    const deliverableType = normalizeText(deliverable.deliverable_type);
    if (deliverableMarker !== marker && deliverableType !== normalizeText(marker)) {
      return false;
    }
    return mode === "sent" ? SENT_LIKE_STATUSES.has(deliverable.status) : DELIVERED_LIKE_STATUSES.has(deliverable.status);
  });
}

function getActiveMarkers(deliverables: CompletionStateInput["deliverables"]) {
  return [...new Set(deliverables.map((deliverable) => deliverable.completion_marker_key).filter((value): value is string => Boolean(value)))];
}

export function evaluateProductionCompletionState(input: CompletionStateInput): ProductionCompletionEvaluation {
  const now = input.now ?? new Date();
  const plan =
    input.plan ??
    buildDepartmentProductionTemplatePlan({
      departmentType: input.item.department_type,
      jobCategory: (input.item.job_type as JobCategory | null | undefined) ?? null,
      title: input.item.title,
      productionType: input.item.production_type,
      proofRequired: input.item.proof_required,
      vendorName: input.item.vendor_name,
      releaseTarget: input.item.release_target
    });
  const releaseComplete =
    ["RELEASED", "DELIVERED", "CLOSED"].includes(input.item.release_status) ||
    ["RELEASED", "DELIVERED_CLOSED"].includes(input.item.workflow_status);
  if (input.item.closed_at || (input.item.completed_at && releaseComplete)) {
    return {
      isCompleted: true,
      completedAt: normalizeTimestamp(input.item.completed_at) ?? normalizeTimestamp(input.item.closed_at) ?? now.toISOString(),
      closedAt: normalizeTimestamp(input.item.closed_at) ?? normalizeTimestamp(input.item.completed_at) ?? now.toISOString(),
      workflowStatus: "DELIVERED_CLOSED",
      releaseStatus: input.item.release_status === "NOT_STARTED" ? "CLOSED" : input.item.release_status,
      evidence: ["existing_completion_timestamp"]
    };
  }

  const activeMarkers = getActiveMarkers(input.deliverables);
  const evidence: string[] = [];
  let completed = false;

  switch (plan.completionRuleKey) {
    case "schools_gallery_or_email": {
      const gallerySatisfied =
        isMarkerSatisfied(input.deliverables, "gallery_release_event") || isMarkerSatisfied(input.deliverables, "gallery_email_sent", "sent");
      if (gallerySatisfied) {
        evidence.push("gallery");
      }
      const nonGalleryMarkers = activeMarkers.filter((marker) => !GALLERY_COMPLETION_MARKERS.has(marker));
      const nonGalleryComplete = nonGalleryMarkers.every((marker) => isMarkerSatisfied(input.deliverables, marker));
      if (nonGalleryComplete && nonGalleryMarkers.length) {
        evidence.push(...nonGalleryMarkers);
      }
      completed = gallerySatisfied && nonGalleryComplete;
      break;
    }
    case "sports_release_date_or_legacy_finished": {
      const importedStatus = normalizeText(input.item.imported_status_source);
      const legacyFinished = importedStatus != null && importedStatus.startsWith("legacy_finished");
      if (releaseComplete) {
        evidence.push("release_status");
      }
      if (legacyFinished) {
        evidence.push("legacy_finished");
      }
      completed = releaseComplete || legacyFinished;
      break;
    }
    case "photos_over_time_event": {
      const preloadSatisfied =
        isMarkerSatisfied(input.deliverables, "gallery_release_event") ||
        isMarkerSatisfied(input.deliverables, "gallery_email_sent", "sent") ||
        isMarkerSatisfied(input.deliverables, "admin_portal_ready", "sent");
      if (preloadSatisfied) {
        evidence.push("preload_release");
      }
      completed = preloadSatisfied;
      break;
    }
    case "specialty_template_marker":
    default: {
      if (!activeMarkers.length) {
        completed = releaseComplete;
        if (releaseComplete) {
          evidence.push("release_status");
        }
        break;
      }
      completed = activeMarkers.every((marker) => isMarkerSatisfied(input.deliverables, marker));
      if (completed) {
        evidence.push(...activeMarkers);
      }
      break;
    }
  }

  if (!completed) {
    return {
      isCompleted: false,
      completedAt: null,
      closedAt: null,
      workflowStatus: null,
      releaseStatus: null,
      evidence
    };
  }

  return {
    isCompleted: true,
    completedAt: normalizeTimestamp(input.item.completed_at) ?? now.toISOString(),
    closedAt: normalizeTimestamp(input.item.closed_at) ?? now.toISOString(),
    workflowStatus: "DELIVERED_CLOSED",
    releaseStatus:
      input.item.release_status === "NOT_STARTED" || input.item.release_status === "PENDING_REVIEW" ? "CLOSED" : input.item.release_status,
    evidence
  };
}

export function mapLegacyProductionProjectToProductionItemSeed(input: LegacyProductionProjectSeedInput) {
  const context: ProductionTemplateContext = {
    departmentType: input.departmentType,
    jobCategory: input.jobType === "banner_specialty_product" || input.jobType === "specialty_graphics" ? "specialty" : "other",
    title: input.title,
    productionType:
      input.jobType === "gallery_prep_upload"
        ? "gallery_release"
        : input.jobType === "banner_specialty_product"
          ? "banner_specialty"
          : input.jobType === "specialty_graphics"
            ? "specialty_graphics"
            : input.jobType === "standard_school_production"
              ? "schools_post_processing"
              : input.jobType === "sports_production"
                ? "sports_post_processing"
                : "legacy_import"
  };
  const plan = buildDepartmentProductionTemplatePlan(context);
  const importedStatusSource =
    input.status === "completed" || input.stage === "released_complete" ? `legacy_finished:${input.status ?? input.stage}` : `legacy_stage:${input.stage ?? "unknown"}`;
  return {
    production_template_key: plan.templateKey,
    completion_rule_key: plan.completionRuleKey,
    production_type: plan.productionType,
    imported_status_source: importedStatusSource,
    legacy_source_reference: `production_project:${input.legacyId}`,
    legacy_owner_history_json: [
      { role: "owner", user_id: input.ownerUserId ?? null },
      { role: "peer_reviewer", user_id: input.peerReviewerUserId ?? null },
      { role: "final_release_reviewer", user_id: input.finalQcReviewerUserId ?? null }
    ].filter((entry) => entry.user_id),
    completed_at: normalizeTimestamp(input.completedAt) ?? null,
    due_at: input.dueDate ?? null,
    deliverable_seeds: plan.deliverableSeeds
  };
}

export function buildLegacySchoolWorkDeliverableSeed(input: LegacySchoolWorkSeedInput): ProductionTemplateDeliverableSeed {
  switch (normalizeText(input.workType)) {
    case "yearbook":
      return {
        deliverable_type: "yearbook_export_sent",
        title: input.title,
        delivery_method: "digital",
        status: "not_started",
        deliverable_group_key: "yearbook",
        completion_marker_key: "yearbook_export_sent",
        legacy_source_reference: `school_work_item:${input.legacyId}`
      };
    case "id_production":
      return {
        deliverable_type: "id_package_delivered",
        title: input.title,
        delivery_method: "physical",
        status: "not_started",
        deliverable_group_key: "id_package",
        completion_marker_key: "id_package_delivered",
        legacy_source_reference: `school_work_item:${input.legacyId}`
      };
    default:
      return {
        deliverable_type: "gallery_live",
        title: input.title,
        delivery_method: "digital",
        status: "not_started",
        deliverable_group_key: "gallery",
        completion_marker_key: "gallery_release_event",
        legacy_source_reference: `school_work_item:${input.legacyId}`
      };
  }
}

export function buildLegacySportsSpecialtyDeliverableSeed(
  input: LegacySportsSpecialtySeedInput
): ProductionTemplateDeliverableSeed {
  const normalizedType = normalizeText(input.productType) ?? "";
  if (normalizedType.includes("banner")) {
    return {
      deliverable_type: "banner_delivered",
      title: input.title,
      delivery_method: "vendor",
      status: "not_started",
      deliverable_group_key: "banners",
      completion_marker_key: "banner_delivery_confirmation",
      vendor_name: input.vendorName ?? null,
      legacy_source_reference: `sports_specialty_product_item:${input.legacyId}`
    };
  }
  if (normalizedType.includes("vendor") || normalizedType.includes("print")) {
    return {
      deliverable_type: "vendor_print_batch_sent",
      title: input.title,
      delivery_method: "vendor",
      status: "not_started",
      deliverable_group_key: "vendor",
      completion_marker_key: "vendor_submission",
      vendor_name: input.vendorName ?? null,
      legacy_source_reference: `sports_specialty_product_item:${input.legacyId}`
    };
  }
  return {
    deliverable_type: "specialty_products_delivered",
    title: input.title,
    delivery_method: input.vendorName ? "vendor" : "digital",
    status: "not_started",
    deliverable_group_key: "specialty_products",
    completion_marker_key: "specialty_delivery_confirmation",
    vendor_name: input.vendorName ?? null,
    legacy_source_reference: `sports_specialty_product_item:${input.legacyId}`
  };
}
