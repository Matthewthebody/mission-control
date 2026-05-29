import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/errors/apiError.js";

describe("central job intake route logging", () => {
  it("logs publish failures with structured job context", async () => {
    process.env.CENTRAL_JOB_INTAKE_V1_ENABLED = "true";
    const { logCentralJobRouteFailure } = await import("../src/routes/centralJobIntake.js");
    const warn = vi.fn();
    const error = vi.fn();

    logCentralJobRouteFailure(
      {
        method: "POST",
        route: { path: "/drafts/:id/publish" },
        params: { id: "job-123" },
        auth: {
          id: "user-1",
          tenantId: "tenant-1"
        },
        log: { warn, error }
      } as never,
      "central_job_intake.publish_failed",
      new ApiError(409, "Duplicate publish blocked", {
        duplicate_result: { disposition: "hard_block" }
      }),
      {
        shoot_id: "job-123",
        duplicate_override_attempted: false
      }
    );

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "central_job_intake.publish_failed",
        method: "POST",
        route_path: "/drafts/:id/publish",
        tenant_id: "tenant-1",
        actor_user_id: "user-1",
        shoot_id: "job-123",
        status_code: 409
      }),
      "Central job intake route failure"
    );
    expect(error).not.toHaveBeenCalled();
  });

  it("logs import session commit failures with structured session context", async () => {
    process.env.CENTRAL_JOB_INTAKE_V1_ENABLED = "true";
    const { logCentralJobRouteFailure } = await import("../src/routes/centralJobIntake.js");
    const warn = vi.fn();
    const error = vi.fn();

    logCentralJobRouteFailure(
      {
        method: "POST",
        route: { path: "/import-sessions/:id/commit" },
        params: { id: "session-123" },
        auth: {
          id: "user-9",
          tenantId: "tenant-9"
        },
        log: { warn, error }
      } as never,
      "central_job_intake.import_session_commit_failed",
      new Error("Injected downstream failure"),
      {
        session_id: "session-123",
        commit_mode: "publish_valid_rows_leave_exceptions",
        acknowledge_soft_duplicates: false,
        override_hard_duplicates: true
      }
    );

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "central_job_intake.import_session_commit_failed",
        method: "POST",
        route_path: "/import-sessions/:id/commit",
        tenant_id: "tenant-9",
        actor_user_id: "user-9",
        session_id: "session-123",
        commit_mode: "publish_valid_rows_leave_exceptions",
        override_hard_duplicates: true,
        error_message: "Injected downstream failure"
      }),
      "Central job intake route failure"
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
