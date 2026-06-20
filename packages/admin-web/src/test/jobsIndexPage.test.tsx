// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobIndexRow, JobsIndexResponse } from "../services/jobsApi";
import type { SessionUser } from "../types";

const getJobsIndexMock = vi.fn();
vi.mock("../services/jobsApi", () => ({ getJobsIndex: (...a: unknown[]) => getJobsIndexMock(...a) }));

import { JobsIndexPage } from "../pages/JobsIndexPage";

function user(): SessionUser {
  return {
    id: "u1", tenantId: "t", accountId: "a", sessionId: "s", email: "lead@example.com", fullName: "Lead", status: "active",
    department: "operations", isEmailVerified: true, authVersion: 1, roles: ["leadership"], permissions: ["dashboard.read"],
    authorityTier: "leadership", primaryJobFunctionProfile: "leadership_team_member", jobFunctionProfiles: ["leadership_team_member"],
    permissionGrants: [], effectiveScopes: ["organization_wide_scope"],
    sessionTrust: { identityProvider: "local_password", sessionAssurance: "standard", requestTransport: "bearer", elevatedUntil: null, privilegedModeUntil: null, breakGlassStartedAt: null, breakGlassUntil: null, breakGlassReason: null, breakGlassScopeType: null, breakGlassScopeId: null, elevatedSessionActive: false, privilegedModeActive: false, breakGlassModeActive: false }
  } as SessionUser;
}

function row(over: Partial<JobIndexRow>): JobIndexRow {
  return {
    id: "job-1", job_number: "SPT-2026-1", title: "Edina Football", event_name: null, organization_id: "o1", organization_name: "Edina HS",
    department_type: "sports", job_category: "media_day", job_date: "2026-09-12T08:00:00", account_owner_user_id: null, owner_name: null,
    job_status: "confirmed", production_status: "queued", readiness_status: "on_track", risk_status: "none", staffing_status: "unassigned",
    client_deadline_at: null, production_deadline_at: null, blocker_count: 0, open_watch_flag_count: 0, incomplete_required_count: 0,
    workflow_run_count: 0, production_item_count: 0, linked_shoot_count: 0, shoot_data_available: false, staffing_data_available: false,
    schedule_data_available: false, workflow_data_available: false, production_data_available: false, shoot_link_status: "unlinked",
    attention_reasons: [], linked_shoot_ids: [], link_sources: [], single_linked_shoot_id: null, operational_data_available: false,
    operational_link_explanation: "No Shoot linked — operational scheduling and staffing data are unavailable until a Shoot is linked.",
    ...over
  };
}

function response(over: Partial<JobsIndexResponse> = {}): JobsIndexResponse {
  return {
    rows: [
      row({}),
      row({ id: "job-2", title: "Wayzata Soccer", shoot_link_status: "linked", linked_shoot_count: 2, linked_shoot_ids: ["s1", "s2"], shoot_data_available: true, link_sources: ["legacy_shoot_id"] }),
      row({ id: "job-3", title: "Maple Grove", workflow_data_available: true, workflow_run_count: 3, shoot_link_status: "unlinked" })
    ],
    summary: {
      total: 3,
      metrics: [
        { key: "needs_attention", label: "Needs Attention", available: true, count: 1 },
        { key: "blocked", label: "Blocked", available: true, count: 7 },
        { key: "waiting_on_client", label: "Waiting on Client", available: false, reason: "No canonical predicate", count: null }
      ]
    },
    page: { limit: 25, offset: 0, total: 3, returned: 3, has_more: false },
    attention_reason_availability: { job_native: ["late", "blocked_no_owner"], unavailable: [{ reason: "not_acknowledged", explanation: "Shoot-scoped" }] },
    applied_metric: null,
    ...over
  };
}

beforeEach(() => {
  window.location.hash = "#jobs";
  getJobsIndexMock.mockReset();
});
afterEach(() => cleanup());

describe("JobsIndexPage", () => {
  it("(30) fetches the canonical index defaulting to the active lifecycle scope", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    await screen.findByRole("heading", { name: "Jobs" });
    expect(getJobsIndexMock).toHaveBeenCalled();
    expect(getJobsIndexMock.mock.calls[0][1]).toMatchObject({ lifecycle_scope: "active" });
  });

  it("(26/29) shows enabled metric counts as buttons and unavailable metrics as disabled (no CTA)", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    const blocked = await screen.findByRole("button", { name: /Blocked/ });
    expect(within(blocked).getByText("7")).toBeInTheDocument();
    // Unavailable metric is not a button.
    expect(screen.queryByRole("button", { name: /Waiting on Client/ })).toBeNull();
    expect(screen.getByText("Waiting on Client")).toBeInTheDocument();
  });

  it("(34) clicking a metric is URL-backed and selecting a job uses jobs.id", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Blocked/ }));
    expect(window.location.hash).toContain("metric=blocked");
    fireEvent.click(screen.getByRole("button", { name: /Wayzata Soccer/ }));
    expect(window.location.hash).toContain("selected=job-2");
  });

  it("(32) lifecycle scope and department are URL-backed", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    await screen.findByRole("heading", { name: "Jobs" });
    fireEvent.change(screen.getByLabelText("Lifecycle scope"), { target: { value: "archived" } });
    expect(window.location.hash).toContain("lifecycle_scope=archived");
  });

  it("(36/37/38) unlinked jobs show no fabricated Shoot state; linked show labeled data; workflow is independent", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    await screen.findByRole("heading", { name: "Jobs" });
    expect(screen.getAllByText("No Shoot linked").length).toBeGreaterThan(0); // unlinked rows
    expect(screen.getByText("Linked · 2")).toBeInTheDocument(); // linked row, labeled
    expect(screen.getByText("3 runs")).toBeInTheDocument(); // workflow data on an unlinked job
  });

  it("(39) renders a dense table at 100+ jobs", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => row({ id: `job-${i}`, title: `Job ${i}` }));
    getJobsIndexMock.mockResolvedValue(response({ rows, page: { limit: 25, offset: 0, total: 1200, returned: 120, has_more: true } }));
    render(<JobsIndexPage token="t" currentUser={user()} />);
    await screen.findByRole("heading", { name: "Jobs" });
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(120); // one <tr> per job + header
    expect(screen.getByRole("button", { name: "Next" })).not.toBeDisabled();
  });

  it("(loading/empty/error) shows honest states", async () => {
    getJobsIndexMock.mockResolvedValue(response({ rows: [], page: { limit: 25, offset: 0, total: 0, returned: 0, has_more: false } }));
    const { unmount } = render(<JobsIndexPage token="t" currentUser={user()} />);
    expect(await screen.findByText("No jobs match this view.")).toBeInTheDocument();
    unmount();
    getJobsIndexMock.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
    render(<JobsIndexPage token="t" currentUser={user()} />);
    expect(await screen.findByText(/We couldn't load jobs/)).toBeInTheDocument();
  });
});
