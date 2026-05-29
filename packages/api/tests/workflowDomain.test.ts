import crypto from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import {
  listWorkflowEntityEvents,
  listApprovalRequestEvents,
  listApprovalRequestRecords,
  listAssignmentEvents,
  listAssignmentRecords,
  listAttendanceEvents,
  listAttendanceRecords,
  listProductionJobEvents,
  listProductionJobRecords,
  listProductionTaskEvents,
  listProductionTaskRecords,
  listStaffingIssueEvents,
  listStaffingIssueRecords,
  listWatchItemEvents,
  listWatchItemRecords,
  loadWorkflowEntityRecord,
  listWorkflowHistory
} from "../src/services/workflowDomain.js";
import { createStaffingIssue, updateStaffingIssueStatus } from "../src/services/staffingIssues.js";

let tenantId = "";
let studioId = "";
let shootId = "";
let leadershipUserId = "";
let photographerUserId = "";

beforeAll(async () => {
  const context = await pool.query(
    `
      SELECT
        tenant.id AS tenant_id,
        studio.id AS studio_id,
        shoot.id AS shoot_id,
        leadership.id AS leadership_user_id,
        photographer.id AS photographer_user_id
      FROM tenant
      JOIN studio
        ON studio.tenant_id = tenant.id
       AND studio.name = 'Main Studio'
      JOIN shoot
        ON shoot.tenant_id = tenant.id
       AND shoot.shoot_code = 'DEMO-001'
      JOIN app_user leadership
        ON leadership.tenant_id = tenant.id
       AND lower(leadership.email) = lower('leadership@example.com')
      JOIN app_user photographer
        ON photographer.tenant_id = tenant.id
       AND lower(photographer.email) = lower('photo@example.com')
      WHERE tenant.name = 'Demo Studio'
      LIMIT 1
    `
  );

  tenantId = context.rows[0].tenant_id;
  studioId = context.rows[0].studio_id;
  shootId = context.rows[0].shoot_id;
  leadershipUserId = context.rows[0].leadership_user_id;
  photographerUserId = context.rows[0].photographer_user_id;
});

describe("workflow domain foundation", () => {
  it("maps normalized workflow records and unified event history across modules", async () => {
    const client = await pool.connect();
    const startedAt = new Date();
    const endedAt = new Date(startedAt.getTime() + 2 * 60 * 60 * 1000);
    const projectDueDate = startedAt.toISOString().slice(0, 10);

    try {
      await client.query("BEGIN");

      const shiftInsert = await client.query<{ id: string }>(
        `
          INSERT INTO work_shift (
            tenant_id,
            shoot_id,
            studio_id,
            assigned_user_id,
            manager_user_id,
            created_by_user_id,
            shift_kind,
            status,
            department,
            title,
            starts_at,
            ends_at,
            location_name,
            location_address
          )
          VALUES ($1, $2, $3, $4, $5, $5, 'shoot', 'published', 'operations', $6, $7, $8, $9, $10)
          RETURNING id
        `,
        [
          tenantId,
          shootId,
          studioId,
          photographerUserId,
          leadershipUserId,
          `WF-${crypto.randomUUID().slice(0, 8)}`,
          startedAt.toISOString(),
          endedAt.toISOString(),
          "Normalized Workflow Test Site",
          "123 Demo Lane"
        ]
      );
      const shiftId = shiftInsert.rows[0].id;

      await client.query(
        `
          INSERT INTO audit_log (
            tenant_id,
            actor_user_id,
            action,
            entity_type,
            entity_id,
            metadata,
            reason_comment
          )
          VALUES ($1, $2, 'schedule.shift_created', 'work_shift', $3, '{}'::jsonb, 'Created for workflow-domain test')
        `,
        [tenantId, leadershipUserId, shiftId]
      );

      const staffingIssue = await createStaffingIssue(client, {
        tenantId,
        issueType: "coverage_gap",
        sourceModule: "scheduling",
        sourceEntityType: "work_shift",
        sourceEntityId: shiftId,
        sourceEntityLabel: "Workflow Domain Shift",
        department: "operations",
        shiftId,
        shootId,
        ownerUserId: leadershipUserId,
        createdByUserId: leadershipUserId,
        dedupeKey: `workflow-domain:${shiftId}:coverage-gap`,
        title: "Coverage gap detected",
        summary: "Seeded staffing issue for normalized domain coverage."
      });

      await updateStaffingIssueStatus(client, {
        tenantId,
        staffingIssueId: staffingIssue.id,
        status: "acknowledged",
        actorUserId: leadershipUserId,
        note: "Manager has seen the staffing issue."
      });

      const watchInsert = await client.query<{ id: string }>(
        `
          INSERT INTO urgent_watch_item (
            tenant_id,
            source_module,
            source_entity_type,
            source_entity_id,
            source_entity_label,
            scope_department,
            watch_type,
            severity,
            title,
            summary,
            owner_user_id,
            due_at,
            next_action_label,
            action_hash,
            operational_impact_score,
            source_snapshot,
            source_fingerprint
          )
          VALUES (
            $1,
            'scheduling',
            'work_shift',
            $2,
            'Workflow Domain Shift',
            'operations',
            'staffing_gap',
            'yellow',
            'Watch item seeded',
            'Seeded watch item for normalized domain coverage.',
            $3,
            $4,
            'Open Scheduling',
            $5,
            80,
            '{}'::jsonb,
            $6
          )
          RETURNING id
        `,
        [
          tenantId,
          shiftId,
          leadershipUserId,
          startedAt.toISOString(),
          `#scheduling?shift=${shiftId}`,
          `workflow-domain-watch:${shiftId}`
        ]
      );
      const watchItemId = watchInsert.rows[0].id;

      await client.query(
        `
          INSERT INTO urgent_watch_event (
            tenant_id,
            urgent_watch_item_id,
            event_type,
            summary,
            actor_user_id,
            metadata
          )
          VALUES ($1, $2, 'watch.generated', 'Urgent Watch item generated.', $3, '{}'::jsonb)
        `,
        [tenantId, watchItemId, leadershipUserId]
      );

      const projectInsert = await client.query<{ id: string }>(
        `
          INSERT INTO production_project (
            tenant_id,
            source_type,
            created_reason,
            title,
            summary,
            status,
            job_type,
            stage,
            priority,
            owner_user_id,
            due_date,
            linked_shoot_id,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES (
            $1,
            'manual',
            'Workflow domain scaffolding test.',
            'Workflow Domain Production Job',
            'Seeded production job.',
            'active',
            'gallery_prep_upload',
            'in_production',
            'high',
            $2,
            $3,
            $4,
            $2,
            $2
          )
          RETURNING id
        `,
        [tenantId, leadershipUserId, projectDueDate, shootId]
      );
      const projectId = projectInsert.rows[0].id;

      await client.query(
        `
          INSERT INTO production_project_event (
            tenant_id,
            project_id,
            event_type,
            summary,
            actor_user_id,
            metadata
          )
          VALUES ($1, $2, 'production_job.created', 'Production job created.', $3, '{}'::jsonb)
        `,
        [tenantId, projectId, leadershipUserId]
      );

      const taskInsert = await client.query<{ id: string }>(
        `
          INSERT INTO production_project_task (
            tenant_id,
            project_id,
            title,
            summary,
            status,
            task_type,
            owner_user_id,
            due_date,
            required,
            sort_order,
            created_by_user_id,
            updated_by_user_id
          )
          VALUES (
            $1,
            $2,
            'Build gallery package',
            'Seeded production task.',
            'in_progress',
            'production',
            $3,
            $4,
            true,
            1,
            $3,
            $3
          )
          RETURNING id
        `,
        [tenantId, projectId, leadershipUserId, projectDueDate]
      );
      const taskId = taskInsert.rows[0].id;

      await client.query(
        `
          INSERT INTO production_project_task_event (
            tenant_id,
            project_id,
            task_id,
            event_type,
            summary,
            actor_user_id,
            metadata
          )
          VALUES ($1, $2, $3, 'production_task.started', 'Production task started.', $4, '{}'::jsonb)
        `,
        [tenantId, projectId, taskId, leadershipUserId]
      );

      const approvalInsert = await client.query<{ id: string }>(
        `
          INSERT INTO operational_approval_request (
            tenant_id,
            request_type,
            status,
            source_module,
            source_entity_type,
            source_entity_id,
            source_entity_label,
            requester_department,
            blocking,
            requested_action_code,
            request_title,
            request_summary,
            reason,
            severity,
            requested_by_user_id,
            approval_chain,
            current_state,
            requested_state,
            metadata
          )
          VALUES (
            $1,
            'staffing_exception_approval',
            'pending',
            'scheduling',
            'work_shift',
            $2,
            'Workflow Domain Shift',
            'operations',
            true,
            'override_shift_assignment',
            'Approve staffing exception',
            'Seeded approval request.',
            'Need a staffing exception for test coverage.',
            'high',
            $3,
            ARRAY['scheduling_lead'],
            '{}'::jsonb,
            '{}'::jsonb,
            '{}'::jsonb
          )
          RETURNING id
        `,
        [tenantId, shiftId, leadershipUserId]
      );
      const approvalRequestId = approvalInsert.rows[0].id;

      await client.query(
        `
          INSERT INTO operational_approval_step (
            tenant_id,
            approval_request_id,
            step_order,
            approver_role_group,
            approver_department,
            approver_user_id,
            status,
            due_at
          )
          VALUES ($1, $2, 1, 'scheduling_lead', 'operations', $3, 'pending', now() + interval '4 hours')
        `,
        [tenantId, approvalRequestId, leadershipUserId]
      );

      await client.query(
        `
          INSERT INTO operational_approval_event (
            tenant_id,
            approval_request_id,
            event_type,
            summary,
            actor_user_id,
            metadata
          )
          VALUES ($1, $2, 'approval.requested', 'Approval request created.', $3, '{}'::jsonb)
        `,
        [tenantId, approvalRequestId, leadershipUserId]
      );

      await client.query(
        `
          INSERT INTO shift_attendance_runtime (
            shift_id,
            tenant_id,
            shoot_id,
            employee_id,
            current_state,
            current_state_reason,
            signal_source,
            last_state_changed_at
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            'scheduled',
            'Waiting for attendance signals.',
            'system_schedule',
            now()
          )
        `,
        [shiftId, tenantId, shootId, photographerUserId]
      );

      await client.query(
        `
          INSERT INTO shift_attendance_history (
            tenant_id,
            shift_id,
            shoot_id,
            employee_id,
            actor_user_id,
            event_type,
            from_state,
            to_state,
            signal_source,
            note,
            metadata
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            'attendance_record.created',
            NULL,
            'scheduled',
            'system_schedule',
            'Attendance record created.',
            '{}'::jsonb
          )
        `,
        [tenantId, shiftId, shootId, photographerUserId, leadershipUserId]
      );

      const assignments = await listAssignmentRecords(client, tenantId, {
        assignmentId: shiftId,
        assignedUserId: photographerUserId,
        limit: 20
      });
      const assignmentEvents = await listAssignmentEvents(client, tenantId, shiftId, 20);
      const staffingIssues = await listStaffingIssueRecords(client, tenantId, { shiftId, limit: 20 });
      const staffingIssueEvents = await listStaffingIssueEvents(client, tenantId, staffingIssue.id, 20);
      const watchItems = await listWatchItemRecords(client, tenantId, { sourceModule: "scheduling", limit: 20 });
      const watchEvents = await listWatchItemEvents(client, tenantId, watchItemId, 20);
      const productionJobs = await listProductionJobRecords(client, tenantId, { ownerUserId: leadershipUserId, limit: 20 });
      const productionJobEvents = await listProductionJobEvents(client, tenantId, projectId, 20);
      const productionTasks = await listProductionTaskRecords(client, tenantId, { productionJobId: projectId, limit: 20 });
      const productionTaskEvents = await listProductionTaskEvents(client, tenantId, taskId, 20);
      const approvalRequests = await listApprovalRequestRecords(client, tenantId, {
        requesterUserId: leadershipUserId,
        limit: 20
      });
      const approvalEvents = await listApprovalRequestEvents(client, tenantId, approvalRequestId, 20);
      const attendanceRecords = await listAttendanceRecords(client, tenantId, { shiftId, limit: 20 });
      const attendanceEvents = await listAttendanceEvents(client, tenantId, shiftId, 20);
      const workflowHistory = [
        ...(await listWorkflowHistory(client, tenantId, { entityType: "assignment", entityId: shiftId, limit: 20 })),
        ...(await listWorkflowHistory(client, tenantId, {
          entityType: "staffing_issue",
          entityId: staffingIssue.id,
          limit: 20
        })),
        ...(await listWorkflowHistory(client, tenantId, { entityType: "watch_item", entityId: watchItemId, limit: 20 })),
        ...(await listWorkflowHistory(client, tenantId, { entityType: "production_job", entityId: projectId, limit: 20 })),
        ...(await listWorkflowHistory(client, tenantId, { entityType: "production_task", entityId: taskId, limit: 20 })),
        ...(await listWorkflowHistory(client, tenantId, {
          entityType: "approval_request",
          entityId: approvalRequestId,
          limit: 20
        })),
        ...(await listWorkflowHistory(client, tenantId, { entityType: "attendance_record", entityId: shiftId, limit: 20 }))
      ];
      const loadedAssignment = await loadWorkflowEntityRecord(client, tenantId, "assignment", shiftId);
      const loadedStaffingIssue = await loadWorkflowEntityRecord(client, tenantId, "staffing_issue", staffingIssue.id);
      const loadedWatchItem = await loadWorkflowEntityRecord(client, tenantId, "watch_item", watchItemId);
      const loadedProductionJob = await loadWorkflowEntityRecord(client, tenantId, "production_job", projectId);
      const loadedProductionTask = await loadWorkflowEntityRecord(client, tenantId, "production_task", taskId);
      const loadedApprovalRequest = await loadWorkflowEntityRecord(client, tenantId, "approval_request", approvalRequestId);
      const loadedAttendanceRecord = await loadWorkflowEntityRecord(client, tenantId, "attendance_record", shiftId);
      const assignmentEventStream = await listWorkflowEntityEvents(client, tenantId, "assignment", shiftId, 20);
      const productionJobEventStream = await listWorkflowEntityEvents(client, tenantId, "production_job", projectId, 20);
      const attendanceEventStream = await listWorkflowEntityEvents(client, tenantId, "attendance_record", shiftId, 20);

      expect(assignments.some((record) => record.id === shiftId)).toBe(true);
      expect(assignmentEvents.some((event) => event.assignment_id === shiftId)).toBe(true);

      expect(staffingIssues.some((record) => record.id === staffingIssue.id && record.status === "acknowledged")).toBe(true);
      expect(staffingIssueEvents.some((event) => event.event_type === "staffing_issue.created")).toBe(true);
      expect(staffingIssueEvents.some((event) => event.event_type === "staffing_issue.status_acknowledged")).toBe(true);

      expect(watchItems.some((record) => record.id === watchItemId && record.source_entity_id === shiftId)).toBe(true);
      expect(watchEvents.some((event) => event.watch_item_id === watchItemId)).toBe(true);

      expect(productionJobs.some((record) => record.id === projectId && record.linked_shoot_id === shootId)).toBe(true);
      expect(productionJobEvents.some((event) => event.production_job_id === projectId)).toBe(true);
      expect(productionTasks.some((record) => record.id === taskId && record.production_job_id === projectId)).toBe(true);
      expect(productionTaskEvents.some((event) => event.production_task_id === taskId)).toBe(true);

      expect(
        approvalRequests.some(
          (record) => record.id === approvalRequestId && record.current_approver_user_id === leadershipUserId
        )
      ).toBe(true);
      expect(approvalEvents.some((event) => event.approval_request_id === approvalRequestId)).toBe(true);

      expect(attendanceRecords.some((record) => record.shift_id === shiftId && record.current_state === "scheduled")).toBe(true);
      expect(attendanceEvents.some((event) => event.attendance_record_id === shiftId)).toBe(true);
      expect(loadedAssignment?.id).toBe(shiftId);
      expect(loadedStaffingIssue?.id).toBe(staffingIssue.id);
      expect(loadedWatchItem?.id).toBe(watchItemId);
      expect(loadedProductionJob?.id).toBe(projectId);
      expect(loadedProductionTask?.id).toBe(taskId);
      expect(loadedApprovalRequest?.id).toBe(approvalRequestId);
      expect(loadedAttendanceRecord?.shift_id).toBe(shiftId);
      expect(assignmentEventStream.some((event) => event.assignment_id === shiftId)).toBe(true);
      expect(productionJobEventStream.some((event) => event.production_job_id === projectId)).toBe(true);
      expect(attendanceEventStream.some((event) => event.attendance_record_id === shiftId)).toBe(true);

      const modules = new Set(workflowHistory.map((event) => event.module));
      expect(modules.has("assignments")).toBe(true);
      expect(modules.has("staffing")).toBe(true);
      expect(modules.has("watch")).toBe(true);
      expect(modules.has("production")).toBe(true);
      expect(modules.has("approvals")).toBe(true);
      expect(modules.has("attendance")).toBe(true);

      expect(
        workflowHistory.some(
          (event) =>
            event.entity_type === "production_task" &&
            event.entity_id === taskId &&
            event.parent_entity_type === "production_job" &&
            event.parent_entity_id === projectId
        )
      ).toBe(true);
      expect(workflowHistory.some((event) => event.entity_type === "assignment" && event.entity_id === shiftId)).toBe(true);
      expect(workflowHistory.some((event) => event.entity_type === "approval_request" && event.entity_id === approvalRequestId)).toBe(
        true
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
