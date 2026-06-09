import { describe, expect, it } from "vitest";
import {
  JOB_WORKFLOW_TEMPLATES,
  applyJobIntakeType,
  buildRoutingPreviewFromForm,
  getJobWorkflowTemplate
} from "../components/jobs/JobRoutingFoundation";
import { createBlankSharedJobFormState } from "../components/jobs/DepartmentJobAdapterUIRegistry";
import type { SharedJobFormState } from "../components/jobs/DepartmentJobAdapterUIRegistry";

function readyForm(department: "schools" | "sports" = "schools"): SharedJobFormState {
  return {
    ...createBlankSharedJobFormState(department),
    organization_id: "org-1",
    primary_contact_id: "contact-1",
    primary_location_id: "location-1",
    scheduled_start_date: "2026-10-12",
    production_deadline_at: "2026-10-20",
    priority_level: "normal"
  };
}

describe("job workflow templates and assignment rules", () => {
  it("defines operational templates for the core intake job types", () => {
    expect(Object.keys(JOB_WORKFLOW_TEMPLATES)).toEqual(
      expect.arrayContaining([
        "school_picture_day",
        "sports_picture_day",
        "graduation",
        "retake_day",
        "specialty",
        "event",
        "yearbook",
        "cap_and_gown"
      ])
    );

    for (const template of Object.values(JOB_WORKFLOW_TEMPLATES)) {
      expect(template.departmentsInvolved.length).toBeGreaterThan(0);
      expect(template.handoffSequence[0]).toBe("Intake");
      expect(template.handoffSequence.at(-1)).toBe("Closed");
      expect(template.defaultTasks.length).toBeGreaterThanOrEqual(5);
      expect(template.defaultTasks.every((task) => task.readinessChecks.length > 0)).toBe(true);
      expect(template.defaultTasks.every((task) => task.commonBlockers.length > 0)).toBe(true);
      expect(template.defaultTasks.every((task) => task.completionCriteria.length > 0)).toBe(true);
      expect(template.defaultTasks.every((task) => task.dueDateLogic.length > 0)).toBe(true);
    }
  });

  it("generates a School Picture Day route with roster readiness and department lead ownership", () => {
    const form = applyJobIntakeType(readyForm("schools"), "school_picture_day");
    const preview = buildRoutingPreviewFromForm(form, "Paige", "school_picture_day");
    const rosterPackage = preview.workPackages.find((workPackage) => workPackage.name === "Roster Collection");

    expect(preview.workflowRouteLabel).toBe("School Picture Day route");
    expect(rosterPackage).toMatchObject({
      ownerDepartment: "Schools",
      assignedPerson: "Jessica",
      assignmentRule: "Department Lead"
    });
    expect(rosterPackage?.commonBlockers).toEqual(expect.arrayContaining(["Missing roster"]));
    expect(rosterPackage?.completionCriteria).toContain("Roster Collection complete");
  });

  it("generates a Sports Picture Day route with team workflow readiness and role fallback", () => {
    const form = applyJobIntakeType(readyForm("sports"), "sports_picture_day");
    const preview = buildRoutingPreviewFromForm(form, "Josh", "sports_picture_day");
    const teamPackage = preview.workPackages.find((workPackage) => workPackage.name === "Team List and QR Readiness");
    const capturePackage = preview.workPackages.find((workPackage) => workPackage.name === "Sports Capture");

    expect(preview.workflowRouteLabel).toBe("Sports Picture Day route");
    expect(teamPackage?.commonBlockers).toEqual(expect.arrayContaining(["Missing team list"]));
    expect(capturePackage).toMatchObject({
      ownerDepartment: "Photography",
      assignedPerson: "Carisa",
      assignmentRule: "Role Fallback"
    });
  });

  it("keeps Graduation and Retake templates plain-language and assignment-aware", () => {
    const graduationTemplate = getJobWorkflowTemplate("graduation");
    const retakeTemplate = getJobWorkflowTemplate("retake_day");

    expect(graduationTemplate.defaultTasks.map((task) => task.name)).toEqual(
      expect.arrayContaining(["Ceremony Details", "Graduation Photographer Assignment", "Graduation Capture"])
    );
    expect(retakeTemplate.defaultTasks.map((task) => task.name)).toEqual(
      expect.arrayContaining(["Retake List Collection", "Retake Photographer Assignment", "Retake Gallery Release"])
    );
    expect(retakeTemplate.defaultTasks.find((task) => task.name === "Retake Photographer Assignment")?.assignmentRuleType).toBe("needs_owner");
  });

  it("supports direct owner, needs owner, and role fallback assignment rules", () => {
    const specialtyPreview = buildRoutingPreviewFromForm(applyJobIntakeType(readyForm("sports"), "specialty"), null, "specialty");
    const directOwnerPackage = specialtyPreview.workPackages.find((workPackage) => workPackage.name === "Due Date Scheduling");
    const needsOwnerTask = getJobWorkflowTemplate("event").defaultTasks.find((task) => task.name === "Coverage Scheduling");
    const roleFallbackPackage = specialtyPreview.workPackages.find((workPackage) => workPackage.name === "Reference Capture");

    expect(directOwnerPackage).toMatchObject({
      assignedPerson: "Brandon",
      assignmentRule: "Direct Owner"
    });
    expect(needsOwnerTask?.assignmentRuleType).toBe("needs_owner");
    expect(roleFallbackPackage).toMatchObject({
      assignedPerson: "Carisa",
      assignmentRule: "Role Fallback"
    });
  });
});
