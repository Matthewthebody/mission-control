export const LEAD_REQUIREMENT_TYPE_REGISTRY = [
  "no_lead_required",
  "at_least_one_lead",
  "minimum_lead_count"
] as const;

export type LeadRequirementType = (typeof LEAD_REQUIREMENT_TYPE_REGISTRY)[number];

const LEAD_REQUIREMENT_TYPE_SET = new Set<string>(LEAD_REQUIREMENT_TYPE_REGISTRY);

export function isLeadRequirementType(value: string): value is LeadRequirementType {
  return LEAD_REQUIREMENT_TYPE_SET.has(value);
}

export function resolveLeadRequirementType(requiredLeadCount: number): LeadRequirementType {
  if (requiredLeadCount <= 0) {
    return "no_lead_required";
  }
  if (requiredLeadCount === 1) {
    return "at_least_one_lead";
  }
  return "minimum_lead_count";
}
