import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_REVIEW_HASH,
  NEEDS_ATTENTION_HASH,
  PROJECT_TRACKING_HASH,
  buildProjectTrackingWorkflowHash,
  isProjectTrackingWorkflowHash,
  normalizeWorkSpineActionHash,
  resolveWorkSpineActionHref
} from "../workSpineRouting";

describe("work spine action routing", () => {
  it("prefers an existing precise Project Tracking workflow hash", () => {
    expect(
      resolveWorkSpineActionHref({
        actionHash: "#project-tracking/workflows/workflow-existing",
        workflowRunId: "workflow-fallback"
      })
    ).toBe("#project-tracking/workflows/workflow-existing");
  });

  it("builds a precise Project Tracking workflow hash from a workflow run id", () => {
    expect(buildProjectTrackingWorkflowHash("workflow 1")).toBe("#project-tracking/workflows/workflow%201");
    expect(resolveWorkSpineActionHref({ workflowRunId: "workflow-1" })).toBe("#project-tracking/workflows/workflow-1");
  });

  it("keeps trusted supported hashes and rejects unsupported raw destinations", () => {
    expect(normalizeWorkSpineActionHash("#production/digital")).toBe("#production/digital");
    expect(resolveWorkSpineActionHref({ actionHash: "project-tracking/workflows/missing-hash" })).toBe(PROJECT_TRACKING_HASH);
    expect(resolveWorkSpineActionHref({ actionHash: "#future/not-supported", fallbackKind: "review" })).toBe(NEEDS_ATTENTION_HASH);
  });

  it("canonicalizes old review and attendance aliases into user-facing destinations", () => {
    expect(resolveWorkSpineActionHref({ actionHash: "#employees/compliance" })).toBe(NEEDS_ATTENTION_HASH);
    expect(resolveWorkSpineActionHref({ actionHash: "#review-desk" })).toBe(NEEDS_ATTENTION_HASH);
    expect(resolveWorkSpineActionHref({ actionHash: "#operations/attendance" })).toBe(ATTENDANCE_REVIEW_HASH);
  });

  it("recognizes only the supported workflow detail route shape", () => {
    expect(isProjectTrackingWorkflowHash("#project-tracking/workflows/workflow-1")).toBe(true);
    expect(isProjectTrackingWorkflowHash("#project-tracking/workflow-templates")).toBe(false);
    expect(isProjectTrackingWorkflowHash("#project-tracking/workflows/workflow-1?filter=blocked")).toBe(false);
  });
});
