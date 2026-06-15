import { describe, expect, it } from "vitest";
import {
  countBySeverity,
  isNeedsAttention,
  selectNeedsAttention,
  type NeedsAttentionItem
} from "../home/needsAttention";

function item(overrides: Partial<NeedsAttentionItem>): NeedsAttentionItem {
  return {
    id: "x",
    area: "production",
    title: "Title",
    issue: "Issue",
    owner: "Owner",
    nextAction: "Next",
    reasons: [],
    severity: "info",
    status: "open",
    ...overrides
  };
}

describe("needsAttention logic", () => {
  it("appears when an item is late", () => {
    expect(isNeedsAttention(item({ reasons: ["late"] }))).toBe(true);
  });

  it("appears when an item is not acknowledged", () => {
    expect(isNeedsAttention(item({ reasons: ["not_acknowledged"] }))).toBe(true);
  });

  it("appears when an item affects a client or shoot within 72 hours", () => {
    expect(isNeedsAttention(item({ reasons: ["affects_client_or_shoot_72h"] }))).toBe(true);
  });

  it("appears when an item is behind promised delivery", () => {
    expect(isNeedsAttention(item({ reasons: ["behind_promised_delivery"] }))).toBe(true);
  });

  it("appears when an item is blocked with no clear owner", () => {
    expect(isNeedsAttention(item({ reasons: ["blocked_no_owner"] }))).toBe(true);
  });

  it("appears when an item is missing required details for an upcoming shoot or handoff", () => {
    expect(isNeedsAttention(item({ reasons: ["missing_required_details"] }))).toBe(true);
  });

  it("does not appear for routine work on schedule (no qualifying reason)", () => {
    expect(isNeedsAttention(item({ reasons: [] }))).toBe(false);
  });

  it("does not appear for informational-only items", () => {
    expect(isNeedsAttention(item({ reasons: [], severity: "info" }))).toBe(false);
  });

  it("does not appear when acknowledged and not late (no qualifying reason)", () => {
    expect(isNeedsAttention(item({ reasons: [], status: "in_progress" }))).toBe(false);
  });

  it("does not appear once resolved, even if it carried a reason", () => {
    expect(isNeedsAttention(item({ reasons: ["late"], status: "resolved" }))).toBe(false);
  });

  it("sorts urgent before watch before info", () => {
    const sorted = selectNeedsAttention([
      item({ id: "watch", reasons: ["late"], severity: "watch" }),
      item({ id: "urgent", reasons: ["late"], severity: "urgent" }),
      item({ id: "info", reasons: ["late"], severity: "info" })
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["urgent", "watch", "info"]);
  });

  it("orders by reason priority within the same severity, including the two new reasons", () => {
    const sorted = selectNeedsAttention([
      item({ id: "not_ack", reasons: ["not_acknowledged"], severity: "watch" }),
      item({ id: "missing", reasons: ["missing_required_details"], severity: "watch" }),
      item({ id: "blocked", reasons: ["blocked_no_owner"], severity: "watch" }),
      item({ id: "client72h", reasons: ["affects_client_or_shoot_72h"], severity: "watch" })
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["client72h", "blocked", "missing", "not_ack"]);
  });

  it("ranks an item carrying multiple reasons by its strongest reason, stably", () => {
    const sorted = selectNeedsAttention([
      item({ id: "late_only", reasons: ["late"], severity: "watch" }),
      item({ id: "multi_72h", reasons: ["not_acknowledged", "affects_client_or_shoot_72h", "late"], severity: "watch" }),
      item({ id: "missing_multi", reasons: ["missing_required_details", "not_acknowledged"], severity: "watch" })
    ]);
    // multi_72h is ranked by its strongest reason (72h), ahead of late-only, ahead of missing + not-acknowledged.
    expect(sorted.map((entry) => entry.id)).toEqual(["multi_72h", "late_only", "missing_multi"]);
  });

  it("raises the emphasized area within the same severity without hiding others", () => {
    const sorted = selectNeedsAttention(
      [
        item({ id: "sports", area: "sports", reasons: ["late"], severity: "watch" }),
        item({ id: "schools", area: "schools", reasons: ["late"], severity: "watch" })
      ],
      "schools"
    );
    expect(sorted[0].id).toBe("schools");
    expect(sorted).toHaveLength(2);
  });

  it("filters out non-qualifying items before sorting", () => {
    const sorted = selectNeedsAttention([
      item({ id: "keep", reasons: ["late"], severity: "urgent" }),
      item({ id: "routine", reasons: [], severity: "info" }),
      item({ id: "resolved", reasons: ["late"], status: "resolved" })
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["keep"]);
  });

  it("counts severities for qualifying items only", () => {
    const counts = countBySeverity([
      item({ reasons: ["late"], severity: "urgent" }),
      item({ reasons: ["late"], severity: "watch" }),
      item({ reasons: [], severity: "urgent" })
    ]);
    expect(counts).toEqual({ urgent: 1, watch: 1, info: 0 });
  });
});
