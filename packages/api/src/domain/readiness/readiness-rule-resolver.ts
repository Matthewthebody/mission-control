import type { ReadinessCheckCode } from "./readiness-check-code.js";
import {
  getReadinessCheckDefinition,
  type ReadinessCheckResult
} from "./readiness-check.js";
import {
  READINESS_RULE_PROFILE_REGISTRY,
  type ReadinessComplexityTier,
  type ReadinessProfileShootType,
  type ReadinessRuleProfile,
  type ResolvedReadinessCheckDefinition,
  type ResolvedReadinessRuleProfile
} from "./readiness-rule-profile.js";

export interface ReadinessRuleResolutionContext {
  shootType: ReadinessProfileShootType;
  complexityScore?: number | null;
}

export interface ReadinessRuleResolver {
  resolve(context: ReadinessRuleResolutionContext): ResolvedReadinessRuleProfile;
}

function uniqueCheckCodes(codes: ReadonlyArray<ReadinessCheckCode>): ReadinessCheckCode[] {
  return [...new Set(codes)];
}

function toEffectiveDefinition(
  profile: ReadinessRuleProfile,
  checkCode: ReadinessCheckCode,
  requiredChecks: Set<ReadinessCheckCode>,
  optionalChecks: Set<ReadinessCheckCode>
): ResolvedReadinessCheckDefinition {
  const baseDefinition = getReadinessCheckDefinition(checkCode);

  return {
    ...baseDefinition,
    weightCategory: profile.weightOverrides?.[checkCode] ?? baseDefinition.weightCategory,
    blockingByDefault: profile.blockerOverrides?.[checkCode] ?? baseDefinition.blockingByDefault,
    required: requiredChecks.has(checkCode),
    optional: optionalChecks.has(checkCode),
    sourceProfileKey: profile.profileKey
  };
}

function buildEffectiveCheckDefinitions(
  profile: ReadinessRuleProfile
): Readonly<Record<ReadinessCheckCode, ResolvedReadinessCheckDefinition>> {
  const requiredChecks = new Set(profile.requiredChecks);
  const optionalChecks = new Set(profile.optionalChecks.filter((checkCode) => !requiredChecks.has(checkCode)));
  const activeCheckCodes = uniqueCheckCodes([...profile.requiredChecks, ...profile.optionalChecks]);

  return Object.fromEntries(
    activeCheckCodes.map((checkCode) => [
      checkCode,
      toEffectiveDefinition(profile, checkCode, requiredChecks, optionalChecks)
    ])
  ) as Readonly<Record<ReadinessCheckCode, ResolvedReadinessCheckDefinition>>;
}

export function resolveReadinessComplexityTier(
  complexityScore: number | null | undefined
): ReadinessComplexityTier {
  if (complexityScore == null) {
    return "standard";
  }

  if (complexityScore >= 80) {
    return "critical";
  }

  if (complexityScore >= 60) {
    return "high";
  }

  if (complexityScore >= 30) {
    return "standard";
  }

  return "low";
}

export function listReadinessRuleProfiles(): ReadinessRuleProfile[] {
  return Object.values(READINESS_RULE_PROFILE_REGISTRY).sort(
    (left, right) => right.priority - left.priority || left.profileKey.localeCompare(right.profileKey)
  );
}

export function resolveReadinessRuleProfile(
  context: ReadinessRuleResolutionContext,
  profileRegistry: Readonly<Record<string, ReadinessRuleProfile>> = READINESS_RULE_PROFILE_REGISTRY
): ResolvedReadinessRuleProfile {
  const complexityScore = context.complexityScore ?? null;
  const complexityTier = resolveReadinessComplexityTier(complexityScore);
  const profile = Object.values(profileRegistry)
    .sort((left, right) => right.priority - left.priority || left.profileKey.localeCompare(right.profileKey))
    .find(
      (candidate) =>
        candidate.shootTypes.includes(context.shootType) &&
        candidate.complexityTiers.includes(complexityTier)
    );

  if (!profile) {
    throw new Error(
      `No readiness rule profile matched shootType=${context.shootType} complexityTier=${complexityTier}.`
    );
  }

  return {
    profileKey: profile.profileKey,
    label: profile.label,
    shootType: context.shootType,
    complexityScore,
    complexityTier,
    requiredChecks: uniqueCheckCodes(profile.requiredChecks),
    optionalChecks: uniqueCheckCodes(profile.optionalChecks.filter((checkCode) => !profile.requiredChecks.includes(checkCode))),
    effectiveCheckDefinitions: buildEffectiveCheckDefinitions(profile),
    profile
  };
}

export function getResolvedReadinessCheckDefinition(
  resolvedProfile: ResolvedReadinessRuleProfile,
  checkCode: ReadinessCheckCode
): ResolvedReadinessCheckDefinition {
  return resolvedProfile.effectiveCheckDefinitions[checkCode];
}

export function listResolvedRequiredReadinessChecks(
  resolvedProfile: ResolvedReadinessRuleProfile
): ResolvedReadinessCheckDefinition[] {
  return resolvedProfile.requiredChecks.map((checkCode) =>
    getResolvedReadinessCheckDefinition(resolvedProfile, checkCode)
  );
}

export function listResolvedOptionalReadinessChecks(
  resolvedProfile: ResolvedReadinessRuleProfile
): ResolvedReadinessCheckDefinition[] {
  return resolvedProfile.optionalChecks.map((checkCode) =>
    getResolvedReadinessCheckDefinition(resolvedProfile, checkCode)
  );
}

export function createProfiledReadinessCheckResult(
  resolvedProfile: ResolvedReadinessRuleProfile,
  checkCode: ReadinessCheckCode,
  input: {
    passed: boolean;
    message?: string | null;
    metadata?: Record<string, unknown>;
    blocking?: boolean;
  }
): ReadinessCheckResult {
  const definition = getResolvedReadinessCheckDefinition(resolvedProfile, checkCode);

  return {
    checkCode,
    passed: input.passed,
    severity: definition.severity,
    weightCategory: definition.weightCategory,
    blocking: input.blocking ?? (!input.passed && definition.blockingByDefault),
    message: input.message ?? null,
    metadata: input.metadata
  };
}

export function createReadinessRuleResolver(
  profileRegistry: Readonly<Record<string, ReadinessRuleProfile>> = READINESS_RULE_PROFILE_REGISTRY
): ReadinessRuleResolver {
  return {
    resolve(context) {
      return resolveReadinessRuleProfile(context, profileRegistry);
    }
  };
}

export const DEFAULT_READINESS_RULE_RESOLVER = createReadinessRuleResolver();
