import type { ReadinessCheckCode } from "./readiness-check-code.js";
import type { ReadinessCheckDefinition } from "./readiness-check.js";
import type { ReadinessWeightCategory } from "./readiness-weight-category.js";

export const READINESS_PROFILE_SHOOT_TYPE_REGISTRY = [
  "schools_underclass_portraits",
  "schools_events",
  "sports",
  "events",
  "studio",
  "headshots",
  "commercial",
  "internal"
] as const;

export type ReadinessProfileShootType = (typeof READINESS_PROFILE_SHOOT_TYPE_REGISTRY)[number];

export const READINESS_COMPLEXITY_TIER_REGISTRY = ["low", "standard", "high", "critical"] as const;

export type ReadinessComplexityTier = (typeof READINESS_COMPLEXITY_TIER_REGISTRY)[number];

export interface ReadinessRuleProfile {
  profileKey: string;
  label: string;
  priority: number;
  shootTypes: ReadonlyArray<ReadinessProfileShootType>;
  complexityTiers: ReadonlyArray<ReadinessComplexityTier>;
  requiredChecks: ReadonlyArray<ReadinessCheckCode>;
  optionalChecks: ReadonlyArray<ReadinessCheckCode>;
  weightOverrides?: Partial<Record<ReadinessCheckCode, ReadinessWeightCategory>>;
  blockerOverrides?: Partial<Record<ReadinessCheckCode, boolean>>;
}

export interface ResolvedReadinessCheckDefinition extends ReadinessCheckDefinition {
  required: boolean;
  optional: boolean;
  sourceProfileKey: string;
}

export interface ResolvedReadinessRuleProfile {
  profileKey: string;
  label: string;
  shootType: ReadinessProfileShootType;
  complexityScore: number | null;
  complexityTier: ReadinessComplexityTier;
  requiredChecks: ReadinessCheckCode[];
  optionalChecks: ReadinessCheckCode[];
  effectiveCheckDefinitions: Readonly<Record<ReadinessCheckCode, ResolvedReadinessCheckDefinition>>;
  profile: ReadinessRuleProfile;
}

const READINESS_PROFILE_SHOOT_TYPE_SET = new Set<string>(READINESS_PROFILE_SHOOT_TYPE_REGISTRY);
const READINESS_COMPLEXITY_TIER_SET = new Set<string>(READINESS_COMPLEXITY_TIER_REGISTRY);

export function isReadinessProfileShootType(value: string): value is ReadinessProfileShootType {
  return READINESS_PROFILE_SHOOT_TYPE_SET.has(value);
}

export function isReadinessComplexityTier(value: string): value is ReadinessComplexityTier {
  return READINESS_COMPLEXITY_TIER_SET.has(value);
}

const ALL_COMPLEXITY_TIERS = [...READINESS_COMPLEXITY_TIER_REGISTRY];

export const READINESS_RULE_PROFILE_REGISTRY: Readonly<Record<string, ReadinessRuleProfile>> = {
  default_operations: {
    profileKey: "default_operations",
    label: "Default Operations Readiness",
    priority: 10,
    shootTypes: [...READINESS_PROFILE_SHOOT_TYPE_REGISTRY],
    complexityTiers: ALL_COMPLEXITY_TIERS,
    requiredChecks: [
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance"
    ],
    optionalChecks: [
      "location_ready",
      "setup_photo_received",
      "pre_service_note_present",
      "open_issue_reviewed"
    ]
  },
  schools_standard: {
    profileKey: "schools_standard",
    label: "Schools Standard Readiness",
    priority: 60,
    shootTypes: ["schools_underclass_portraits", "schools_events"],
    complexityTiers: ["low", "standard"],
    requiredChecks: [
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance",
      "location_ready",
      "pre_service_note_present"
    ],
    optionalChecks: ["setup_photo_received", "open_issue_reviewed"],
    weightOverrides: {
      pre_service_note_present: "high"
    },
    blockerOverrides: {
      location_ready: true
    }
  },
  schools_complex: {
    profileKey: "schools_complex",
    label: "Schools Complex Readiness",
    priority: 90,
    shootTypes: ["schools_underclass_portraits", "schools_events"],
    complexityTiers: ["high", "critical"],
    requiredChecks: [
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance",
      "location_ready",
      "pre_service_note_present",
      "setup_photo_received",
      "open_issue_reviewed"
    ],
    optionalChecks: [],
    weightOverrides: {
      location_ready: "critical",
      pre_service_note_present: "high",
      setup_photo_received: "high",
      open_issue_reviewed: "high"
    },
    blockerOverrides: {
      location_ready: true,
      open_issue_reviewed: true
    }
  },
  sports_complex: {
    profileKey: "sports_complex",
    label: "Sports Complex Readiness",
    priority: 80,
    shootTypes: ["sports"],
    complexityTiers: ["high", "critical"],
    requiredChecks: [
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance",
      "location_ready",
      "open_issue_reviewed"
    ],
    optionalChecks: ["setup_photo_received", "pre_service_note_present"],
    weightOverrides: {
      equipment_ready: "critical",
      location_ready: "critical",
      open_issue_reviewed: "high"
    },
    blockerOverrides: {
      location_ready: true
    }
  },
  studio_headshots: {
    profileKey: "studio_headshots",
    label: "Studio and Headshots Readiness",
    priority: 70,
    shootTypes: ["studio", "headshots"],
    complexityTiers: ALL_COMPLEXITY_TIERS,
    requiredChecks: [
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance"
    ],
    optionalChecks: ["location_ready", "setup_photo_received", "pre_service_note_present", "open_issue_reviewed"],
    weightOverrides: {
      location_ready: "low",
      setup_photo_received: "low"
    }
  },
  internal_operations: {
    profileKey: "internal_operations",
    label: "Internal Operations Readiness",
    priority: 75,
    shootTypes: ["internal"],
    complexityTiers: ALL_COMPLEXITY_TIERS,
    requiredChecks: [
      "staffing_complete",
      "lead_assigned",
      "schedule_timing_confirmed",
      "equipment_ready",
      "approval_clearance",
      "pre_service_note_present"
    ],
    optionalChecks: ["location_ready", "setup_photo_received", "open_issue_reviewed"],
    weightOverrides: {
      pre_service_note_present: "high",
      location_ready: "low"
    },
    blockerOverrides: {
      open_issue_reviewed: true
    }
  }
} as const;
