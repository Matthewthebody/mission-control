import type { StaffingAssignment } from "./staffing-assignment.js";
import type {
  InternalStaffingAssignmentDto,
  InternalStaffingDto,
  PublishedStaffingAssignmentDto,
  PublishedStaffingDto
} from "./staffing-publication-dto.js";
import type { StaffingPublicationState } from "./staffing-publication-state.js";
import type {
  StaffingPublicationRequest,
  StaffingPublicationResult,
  StaffingPublicationValidationHookContext,
  StaffingPublicationValidationHookRegistry,
  StaffingPublicationValidationHookResult
} from "./staffing-publication.js";

export interface StaffingPublicationWorkflowOptions {
  validationHookRegistry?: StaffingPublicationValidationHookRegistry;
}

function resolveTargetPublicationState(request: StaffingPublicationRequest): StaffingPublicationState {
  return request.publicationAction === "publish" ? "published" : "draft";
}

function buildInternalStaffingAssignmentDto(assignment: StaffingAssignment): InternalStaffingAssignmentDto {
  return {
    assignmentId: assignment.assignmentId,
    shootId: assignment.shootId,
    employeeId: assignment.employeeId,
    assignmentRole: assignment.assignmentRole,
    assignmentStatus: assignment.assignmentStatus,
    countsTowardLeadCoverage: assignment.countsTowardLeadCoverage,
    linkedShiftId: assignment.linkedShiftId ?? null
  };
}

function buildInternalStaffingDto(
  request: StaffingPublicationRequest,
  resultingPublicationState: StaffingPublicationState
): InternalStaffingDto {
  return {
    requirementId: request.requirement.requirementId,
    shootId: request.requirement.shootId,
    publicationState: resultingPublicationState,
    plannedStaffCount: request.requirement.plannedStaffCount,
    requiredLeadCount: request.requirement.requiredLeadCount,
    employeeVisibleScheduleReleased: resultingPublicationState === "published",
    assignments: request.assignments.map(buildInternalStaffingAssignmentDto)
  };
}

function shouldIncludePublishedAssignment(assignment: StaffingAssignment) {
  return assignment.assignmentStatus !== "cancelled";
}

function buildPublishedStaffingAssignmentDto(
  assignment: StaffingAssignment
): PublishedStaffingAssignmentDto {
  return {
    assignmentId: assignment.assignmentId,
    shootId: assignment.shootId,
    employeeId: assignment.employeeId,
    assignmentRole: assignment.assignmentRole,
    employeeVisible: true
  };
}

function buildPublishedStaffingDto(
  request: StaffingPublicationRequest,
  resultingPublicationState: StaffingPublicationState
): PublishedStaffingDto | null {
  if (resultingPublicationState !== "published") {
    return null;
  }

  const assignments = request.assignments
    .filter(shouldIncludePublishedAssignment)
    .map(buildPublishedStaffingAssignmentDto);

  return {
    shootId: request.requirement.shootId,
    publicationState: "published",
    publishedAssignmentCount: assignments.length,
    assignments
  };
}

function buildValidationHookResults(
  request: StaffingPublicationRequest,
  targetPublicationState: StaffingPublicationState,
  validationHookRegistry: StaffingPublicationValidationHookRegistry
): StaffingPublicationValidationHookResult[] {
  const context: StaffingPublicationValidationHookContext = {
    request,
    targetPublicationState,
    actionEvaluation: request.actionEvaluation ?? null
  };

  return Object.values(validationHookRegistry).map((hook) => hook.evaluate(context));
}

export function runStaffingPublicationWorkflow(
  request: StaffingPublicationRequest,
  options: StaffingPublicationWorkflowOptions = {}
): StaffingPublicationResult {
  const targetPublicationState = resolveTargetPublicationState(request);

  if (request.currentPublicationState === targetPublicationState) {
    const internalStaffing = buildInternalStaffingDto(request, request.currentPublicationState);
    return {
      allowed: false,
      publicationAction: request.publicationAction,
      currentPublicationState: request.currentPublicationState,
      targetPublicationState,
      denialReason: "already_in_target_state",
      publicationStateChanged: false,
      employeeVisibleScheduleReleased: request.currentPublicationState === "published",
      overrideRequired: false,
      overrideRequirement: null,
      validationHookResults: [],
      blockingHookResults: [],
      warningHookResults: [],
      internalStaffing,
      publishedStaffing: buildPublishedStaffingDto(request, request.currentPublicationState)
    };
  }

  if (
    request.publicationAction === "publish" &&
    request.actionEvaluation?.overrideRequirement &&
    !request.overrideAcknowledged
  ) {
    const internalStaffing = buildInternalStaffingDto(request, request.currentPublicationState);
    return {
      allowed: false,
      publicationAction: request.publicationAction,
      currentPublicationState: request.currentPublicationState,
      targetPublicationState,
      denialReason: "override_required",
      publicationStateChanged: false,
      employeeVisibleScheduleReleased: request.currentPublicationState === "published",
      overrideRequired: true,
      overrideRequirement: request.actionEvaluation.overrideRequirement,
      validationHookResults: [],
      blockingHookResults: [],
      warningHookResults: [],
      internalStaffing,
      publishedStaffing: buildPublishedStaffingDto(request, request.currentPublicationState)
    };
  }

  const validationHookResults = options.validationHookRegistry
    ? buildValidationHookResults(request, targetPublicationState, options.validationHookRegistry)
    : [];
  const blockingHookResults = validationHookResults.filter((result) => result.outcome === "block");
  const warningHookResults = validationHookResults.filter((result) => result.outcome === "warning");

  if (blockingHookResults.length > 0) {
    const internalStaffing = buildInternalStaffingDto(request, request.currentPublicationState);
    return {
      allowed: false,
      publicationAction: request.publicationAction,
      currentPublicationState: request.currentPublicationState,
      targetPublicationState,
      denialReason: "blocked_by_validation_hook",
      publicationStateChanged: false,
      employeeVisibleScheduleReleased: request.currentPublicationState === "published",
      overrideRequired: false,
      overrideRequirement: request.actionEvaluation?.overrideRequirement ?? null,
      validationHookResults,
      blockingHookResults,
      warningHookResults,
      internalStaffing,
      publishedStaffing: buildPublishedStaffingDto(request, request.currentPublicationState)
    };
  }

  const internalStaffing = buildInternalStaffingDto(request, targetPublicationState);
  return {
    allowed: true,
    publicationAction: request.publicationAction,
    currentPublicationState: request.currentPublicationState,
    targetPublicationState,
    denialReason: null,
    publicationStateChanged: request.currentPublicationState !== targetPublicationState,
    employeeVisibleScheduleReleased: targetPublicationState === "published",
    overrideRequired: Boolean(request.actionEvaluation?.overrideRequirement),
    overrideRequirement: request.actionEvaluation?.overrideRequirement ?? null,
    validationHookResults,
    blockingHookResults,
    warningHookResults,
    internalStaffing,
    publishedStaffing: buildPublishedStaffingDto(request, targetPublicationState)
  };
}
