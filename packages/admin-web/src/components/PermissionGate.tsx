import { useMemo, type ReactNode } from "react";
import type { SharedResourcePolicySnapshot, SharedVisibilityState } from "../jobTruthTypes";
import { hasPermission } from "../permissions";
import type { SessionUser } from "../types";

type PermissionContext = {
  departmentType?: string | null;
};

type GateProps = {
  allowed: boolean;
  children: ReactNode;
  fallback?: ReactNode;
};

type PolicyGateProps = {
  policy?: SharedResourcePolicySnapshot | null;
  fieldKey?: string | null;
  sectionKey?: string | null;
  allowMasked?: boolean;
  fallback?: ReactNode;
  children: ReactNode;
};

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function hasPolicyPermission(user: SessionUser, permissionKey: string, context?: PermissionContext | null) {
  const grants = user.policyGrants ?? [];
  const relevant = grants.filter((grant) => grant.permissionKey === permissionKey);
  if (!relevant.length) {
    return hasPermission(user, permissionKey);
  }
  const department = normalize(context?.departmentType);
  if (
    relevant.some(
      (grant) =>
        grant.effect === "deny" &&
        (grant.scopeType === "global" ||
          (grant.scopeType === "department" && normalize(grant.scopeValue) === department) ||
          grant.scopeType === "assigned" ||
          grant.scopeType === "owned" ||
          grant.scopeType === "self")
    )
  ) {
    return false;
  }
  return relevant.some((grant) => {
    if (grant.effect !== "allow") {
      return false;
    }
    if (grant.scopeType === "global") {
      return true;
    }
    if (grant.scopeType === "department") {
      return Boolean(department && normalize(grant.scopeValue) === department);
    }
    return true;
  });
}

export function usePermission(user: SessionUser, permissionKey: string, context?: PermissionContext | null) {
  return useMemo(() => hasPolicyPermission(user, permissionKey, context), [context?.departmentType, permissionKey, user]);
}

export function useVisibleFields(policy?: SharedResourcePolicySnapshot | null) {
  return useMemo(() => policy?.fields ?? {}, [policy]);
}

export function useVisibleSections(policy?: SharedResourcePolicySnapshot | null) {
  return useMemo(() => policy?.sections ?? {}, [policy]);
}

export function useActionAvailability(policy?: SharedResourcePolicySnapshot | null) {
  return useMemo(() => policy?.actions ?? {}, [policy]);
}

function isVisible(state: SharedVisibilityState | undefined, allowMasked: boolean) {
  if (!state) {
    return true;
  }
  if (state === "hidden") {
    return false;
  }
  if (!allowMasked && state === "masked") {
    return false;
  }
  return true;
}

export function PermissionGate({ allowed, children, fallback = null }: GateProps) {
  return <>{allowed ? children : fallback}</>;
}

export function FieldGate({ policy, fieldKey, allowMasked = true, fallback = null, children }: PolicyGateProps) {
  const fields = useVisibleFields(policy);
  return <>{!fieldKey || isVisible(fields[fieldKey], allowMasked) ? children : fallback}</>;
}

export function SectionGate({ policy, sectionKey, allowMasked = false, fallback = null, children }: PolicyGateProps) {
  const sections = useVisibleSections(policy);
  return <>{!sectionKey || isVisible(sections[sectionKey], allowMasked) ? children : fallback}</>;
}
