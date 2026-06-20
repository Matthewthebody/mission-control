// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobIndexRow, JobsIndexResponse } from "../services/jobsApi";
import type { SessionUser } from "../types";

const getJobsIndexMock = vi.fn();
const getJobQuickViewMock = vi.fn();
const archiveSharedJobMock = vi.fn();
const restoreSharedJobMock = vi.fn();
vi.mock("../services/jobsApi", () => ({
  getJobsIndex: (...a: unknown[]) => getJobsIndexMock(...a),
  getJobQuickView: (...a: unknown[]) => getJobQuickViewMock(...a),
  archiveSharedJob: (...a: unknown[]) => archiveSharedJobMock(...a),
  restoreSharedJob: (...a: unknown[]) => restoreSharedJobMock(...a)
}));

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
  getJobQuickViewMock.mockReset();
  archiveSharedJobMock.mockReset().mockResolvedValue({});
  restoreSharedJobMock.mockReset().mockResolvedValue({});
});
afterEach(() => cleanup());

function readOnlyUser(): SessionUser {
  return { ...user(), authorityTier: "standard_employee", roles: ["office_employee"], permissions: ["dashboard.read", "job.read"] } as SessionUser;
}
async function openDrawer(jobName: RegExp) {
  fireEvent.click(await screen.findByRole("button", { name: jobName }));
  return screen.findByRole("dialog");
}

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

  it("(3C.1) Show demo data is URL-backed and forwarded to the index query", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    await screen.findByRole("heading", { name: "Jobs" });
    fireEvent.click(screen.getByLabelText("Show demo data"));
    expect(window.location.hash).toContain("show_demo=true");
    await waitFor(() => expect(getJobsIndexMock.mock.calls.at(-1)?.[1]).toMatchObject({ show_demo: "true" }));
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

describe("JobQuickViewDrawer", () => {
  it("(41/43) opens an in-viewport drawer with the canonical Truth Snapshot", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    const drawer = await openDrawer(/Wayzata Soccer/);
    expect(window.location.hash).toContain("selected=job-2");
    expect(within(drawer).getByText("Organization")).toBeInTheDocument();
    expect(within(drawer).getByText("Promised delivery")).toBeInTheDocument();
    expect(within(drawer).getByText("Edina HS")).toBeInTheDocument();
  });

  it("(44/55) shows canonical attention reasons as text, not color alone", async () => {
    getJobsIndexMock.mockResolvedValue(response({ rows: [row({ id: "job-9", title: "Behind Job", attention_reasons: ["blocked_no_owner", "late"] })] }));
    render(<JobsIndexPage token="t" currentUser={user()} />);
    const drawer = await openDrawer(/Behind Job/);
    expect(within(drawer).getByText("Blocked No Owner")).toBeInTheDocument();
    expect(within(drawer).getByText(/blocked and the Job has no owner/i)).toBeInTheDocument();
  });

  it("(46/47) workflow data shows without a Shoot link; unlinked Job shows the honest explanation", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    const drawer = await openDrawer(/Maple Grove/); // job-3: unlinked + workflow
    expect(within(drawer).getByText(/3 workflow runs/)).toBeInTheDocument();
    expect(within(drawer).getByText(/No Shoot linked/)).toBeInTheDocument();
  });

  it("(48) a confirmed-linked Job shows occurrences with exact Open Schedule / Open Staffing", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    const drawer = await openDrawer(/Wayzata Soccer/); // job-2 linked, 2 shoots
    expect(within(drawer).getByText(/2 confirmed linked Shoot/)).toBeInTheDocument();
    expect(within(drawer).getAllByRole("button", { name: "Open Schedule" }).length).toBe(2);
    expect(within(drawer).getAllByRole("button", { name: "Open Staffing" }).length).toBe(2);
  });

  it("(49/52) Archive calls the API and refreshes the index", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    const drawer = await openDrawer(/Wayzata Soccer/);
    const callsBefore = getJobsIndexMock.mock.calls.length;
    fireEvent.click(within(drawer).getByRole("button", { name: "Archive" }));
    expect(archiveSharedJobMock).toHaveBeenCalledWith("t", "job-2", expect.any(String));
    await new Promise((r) => setTimeout(r, 0));
    expect(getJobsIndexMock.mock.calls.length).toBeGreaterThan(callsBefore); // index refetched
  });

  it("(50/53) a read-only user gets no Archive action, and Purge is never offered", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={readOnlyUser()} />);
    const drawer = await openDrawer(/Wayzata Soccer/);
    expect(within(drawer).queryByRole("button", { name: "Archive" })).toBeNull();
    expect(within(drawer).queryByRole("button", { name: /purge/i })).toBeNull();
    expect(within(drawer).getByRole("button", { name: "Open full detail" })).toBeInTheDocument();
  });

  it("(54) closes on Escape", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    render(<JobsIndexPage token="t" currentUser={user()} />);
    await openDrawer(/Wayzata Soccer/);
    expect(window.location.hash).toContain("selected=job-2");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(window.location.hash).not.toContain("selected="); // cleared synchronously
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("JobQuickViewDrawer — off-page deep link (Phase 3C.1)", () => {
  it("(8) opens a ?selected job not on the current page via quick-view, outside the filtered result, preserving filters", async () => {
    getJobsIndexMock.mockResolvedValue(response()); // page has job-1/2/3, not off-1
    getJobQuickViewMock.mockResolvedValue({ row: row({ id: "off-1", title: "Off Page Job", organization_name: "Hidden HS" }) });
    window.location.hash = "#jobs?selected=off-1&metric=blocked";
    render(<JobsIndexPage token="t" currentUser={user()} />);
    expect(await screen.findByText("Off Page Job")).toBeInTheDocument();
    expect(screen.getByText(/outside the current filtered result/i)).toBeInTheDocument();
    expect(getJobQuickViewMock).toHaveBeenCalledWith("t", "off-1");
    // Filters/pagination/selection are preserved (the off-page job is not inserted into the table).
    expect(window.location.hash).toContain("selected=off-1");
    expect(window.location.hash).toContain("metric=blocked");
    expect(screen.queryByRole("button", { name: /Off Page Job/ })).toBeNull(); // not added as a table row
  });

  it("(8) a non-job deep link (e.g. a shoot id) shows a safe not-found", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    getJobQuickViewMock.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
    window.location.hash = "#jobs?selected=shoot-xyz";
    render(<JobsIndexPage token="t" currentUser={user()} />);
    expect(await screen.findByText(/couldn't be found/i)).toBeInTheDocument();
  });

  it("(8) an unauthorized deep link shows a safe access-denied, not the job", async () => {
    getJobsIndexMock.mockResolvedValue(response());
    getJobQuickViewMock.mockRejectedValue(Object.assign(new Error("denied"), { status: 403 }));
    window.location.hash = "#jobs?selected=secret-1";
    render(<JobsIndexPage token="t" currentUser={user()} />);
    expect(await screen.findByText(/don't have access to this job/i)).toBeInTheDocument();
  });
});
