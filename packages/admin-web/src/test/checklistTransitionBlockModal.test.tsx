import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChecklistTransitionBlockModal } from "../components/checklists/ChecklistTransitionBlockModal";
import type { ChecklistTransitionValidation } from "../checklistTypes";

function createValidation(overrides: Partial<ChecklistTransitionValidation> = {}): ChecklistTransitionValidation {
  return {
    allowed: false,
    hard_blocked: false,
    soft_blocked: true,
    issues: [
      {
        template_code: "peer_review_sign_off",
        template_name: "Peer Review Sign-Off",
        instance_id: "instance-1",
        blocking_level: "soft_block",
        required_status: "approved",
        current_status: "submitted",
        approval_required: true,
        progress_percent: 75,
        missing_item_ids: ["item-sort", "item-proof"],
        missing_proof_item_ids: ["item-proof"],
        missing_item_labels: ["Sorting verified", "Upload screenshot"],
        missing_proof_item_labels: ["Upload screenshot"],
        missing_approval: true,
        message: "Peer Review Sign-Off is required before this step can continue."
      }
    ],
    ...overrides
  };
}

describe("ChecklistTransitionBlockModal", () => {
  it("requires an override reason before allowing a soft-block override", () => {
    const confirmOverride = vi.fn();
    render(
      <ChecklistTransitionBlockModal
        open
        validation={createValidation()}
        canOverride
        overrideReason=""
        onOverrideReasonChange={() => {}}
        onClose={() => {}}
        onConfirmOverride={confirmOverride}
      />
    );

    const overrideButton = screen.getByRole("button", { name: "Continue with Override" });
    expect(overrideButton).toBeDisabled();
    expect(screen.getByText("Peer Review Sign-Off")).toBeInTheDocument();
    expect(screen.getByText("Sorting verified")).toBeInTheDocument();
    expect(screen.getAllByText("Upload screenshot").length).toBeGreaterThan(0);
    expect(screen.getByText("Manager approval is still required.")).toBeInTheDocument();
  });

  it("hides override controls for hard blocks", () => {
    render(
      <ChecklistTransitionBlockModal
        open
        validation={createValidation({
          hard_blocked: true,
          soft_blocked: false,
          issues: [
            {
              ...createValidation().issues[0],
              blocking_level: "hard_block"
            }
          ]
        })}
        canOverride
        overrideReason="Leadership note"
        onOverrideReasonChange={() => {}}
        onClose={() => {}}
        onConfirmOverride={() => {}}
      />
    );

    expect(screen.getByRole("heading", { name: "This step is blocked" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue with Override" })).not.toBeInTheDocument();
  });

  it("passes override intent through when a reason is present", () => {
    const confirmOverride = vi.fn();
    render(
      <ChecklistTransitionBlockModal
        open
        validation={createValidation()}
        canOverride
        overrideReason="Manager approved an emergency move."
        onOverrideReasonChange={() => {}}
        onClose={() => {}}
        onConfirmOverride={confirmOverride}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue with Override" }));
    expect(confirmOverride).toHaveBeenCalledTimes(1);
  });
});
