// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  JOB_OPERATIONAL_APPROVAL_OPTIONS,
  OperationalApprovalRequestPanel
} from "../components/OperationalApprovalRequestPanel";

const createOperationalApprovalRequestMock = vi.fn();
const getOperationalApprovalSourceSummaryMock = vi.fn();

vi.mock("../services/operationalApprovals", () => ({
  createOperationalApprovalRequest: (...args: unknown[]) => createOperationalApprovalRequestMock(...args),
  getOperationalApprovalSourceSummary: (...args: unknown[]) => getOperationalApprovalSourceSummaryMock(...args)
}));

describe("OperationalApprovalRequestPanel", () => {
  beforeEach(() => {
    createOperationalApprovalRequestMock.mockReset();
    getOperationalApprovalSourceSummaryMock.mockReset();
  });

  it("loads linked approvals and lets a record owner submit a new operational approval request", async () => {
    getOperationalApprovalSourceSummaryMock
      .mockResolvedValueOnce({
        source_module: "jobs",
        source_entity_type: "job",
        source_entity_id: "job-1",
        open_count: 1,
        blocking_open_count: 1,
        overdue_count: 0,
        escalated_count: 0,
        items: [
          {
            id: "approval-1",
            request_type: "schedule_change_approval",
            request_type_label: "Schedule Change",
            status: "pending",
            status_label: "Pending",
            source_module: "jobs",
            source_entity_type: "job",
            source_entity_id: "job-1",
            source_entity_label: "JOB-001",
            requested_action_code: "job.reschedule",
            request_title: "Reschedule Approval for JOB-001",
            request_summary: "Needs a same-weekend move.",
            reason: "Client requested a new time.",
            severity: "high",
            blocking: true,
            requester_department: "sports",
            requested_by_user_id: "user-1",
            requested_by_name: "Alex Owner",
            approval_chain: ["department_manager"],
            current_approver_user_id: "user-2",
            current_approver_name: "Department Manager",
            current_approver_role_group: "department_manager",
            current_approver_role_group_label: "Department Manager",
            sla_due_at: null,
            overdue: false,
            escalated: false,
            escalation_level: 0,
            decided_at: null,
            executed_at: null,
            created_at: "2026-04-01T12:00:00.000Z",
            updated_at: "2026-04-01T12:00:00.000Z",
            can_decide: false,
            can_cancel: true,
            can_resubmit: false,
            can_delegate: false
          }
        ]
      })
      .mockResolvedValueOnce({
        source_module: "jobs",
        source_entity_type: "job",
        source_entity_id: "job-1",
        open_count: 2,
        blocking_open_count: 2,
        overdue_count: 0,
        escalated_count: 0,
        items: []
      });
    createOperationalApprovalRequestMock.mockResolvedValue({
      id: "approval-2",
      request_type: "fee_refund_approval",
      request_type_label: "Fee Refund",
      status: "pending",
      status_label: "Pending"
    });

    render(
      <OperationalApprovalRequestPanel
        token="token-demo"
        sourceModule="jobs"
        sourceEntityType="job"
        sourceEntityId="job-1"
        sourceEntityLabel="JOB-001"
        canCreate
        requestOptions={JOB_OPERATIONAL_APPROVAL_OPTIONS}
      />
    );

    expect(await screen.findByText("Reschedule Approval for JOB-001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Request Approval" }));
    fireEvent.change(screen.getByLabelText("Approval type"), { target: { value: "fee_refund_approval" } });
    fireEvent.change(screen.getByLabelText("Approval title"), { target: { value: "Fee / Refund Approval for JOB-001" } });
    fireEvent.change(screen.getByLabelText("Approval summary"), { target: { value: "Need approval for a partial refund." } });
    fireEvent.change(screen.getByLabelText("Approval reason"), { target: { value: "Customer service confirmed the service recovery request." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Approval" }));

    await waitFor(() =>
      expect(createOperationalApprovalRequestMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          request_type: "fee_refund_approval",
          source_module: "jobs",
          source_entity_type: "job",
          source_entity_id: "job-1",
          requested_action_code: "job.fee_refund",
          request_title: "Fee / Refund Approval for JOB-001",
          request_summary: "Need approval for a partial refund.",
          reason: "Customer service confirmed the service recovery request.",
          blocking: true
        })
      )
    );

    expect(await screen.findByText("Fee Refund submitted.")).toBeInTheDocument();
    expect(getOperationalApprovalSourceSummaryMock).toHaveBeenCalledTimes(2);
  });
});
