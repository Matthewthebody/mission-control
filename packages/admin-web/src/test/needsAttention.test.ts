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
