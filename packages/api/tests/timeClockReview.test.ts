import { describe, expect, it } from "vitest";
import { deriveTimeReviewSummary } from "../src/services/timeClockReview.js";

describe("time clock review summary", () => {
  it("classifies a no-show-suspected record as missing clock-in with critical review priority", () => {
    const result = deriveTimeReviewSummary({
      shiftAttendanceState: "no_show_suspected",
      exceptionStatus: "open",
      exceptionSeverity: "critical"
    });

    expect(result.timeRecordState).toBe("missing_clock_in");
    expect(result.timeRecordStateLabel).toBe("Missing Clock-In");
    expect(result.correctionState).toBe("requested");
    expect(result.reviewPriority).toBe("critical");
    expect(result.reviewPriorityLabel).toBe("Critical Review");
  });

  it("keeps an active punch clocked in while routing ambiguous GPS to review", () => {
    const result = deriveTimeReviewSummary({
      latestPunchDirection: "in",
      latestPunchApprovalState: "pending_review",
      latestPunchGeofenceStatus: "unknown"
    });

    expect(result.timeRecordState).toBe("clocked_in");
    expect(result.locationState).toBe("pending_location_review");
    expect(result.locationStateLabel).toBe("Pending Location Review");
    expect(result.reviewPriority).toBe("medium");
  });

  it("surfaces excused exceptions without rewriting the underlying raw history", () => {
    const result = deriveTimeReviewSummary({
      exceptionClassification: "excused_exception",
      exceptionStatus: "approved"
    });

    expect(result.timeRecordState).toBe("excused_exception");
    expect(result.correctionState).toBe("excused_exception");
    expect(result.finalizationState).toBe("open_for_review");
  });

  it("marks approved sessions as finalized", () => {
    const result = deriveTimeReviewSummary({
      clockInAt: "2026-03-30T13:00:00.000Z",
      clockOutAt: "2026-03-30T21:00:00.000Z",
      timeSessionStatus: "approved"
    });

    expect(result.timeRecordState).toBe("finalized");
    expect(result.correctionState).toBe("finalized");
    expect(result.finalizationState).toBe("finalized");
    expect(result.nearingFinalization).toBe(false);
  });
});
