// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SharedJobDetailShell } from "../components/jobs/SharedJobDetailShell";
import { SharedJobFormShell } from "../components/jobs/SharedJobFormShell";
import { SharedJobListShell } from "../components/jobs/SharedJobListShell";

describe("shared job shells", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the shared job form shell with core and adapter sections", () => {
    render(
      <SharedJobFormShell
        eyebrow="Schools"
        title="New Job"
        summary="One shared form contract for every department."
        meta={[{ label: "Draft", tone: "info" }]}
        sections={[
          {
            key: "core",
            title: "Core Identity",
            summary: "Shared schedule and ownership fields",
            body: <div>Core schedule and ownership fields</div>
          },
          {
            key: "adapter",
            title: "School Data",
            summary: "Schools adapter fields",
            issueCount: 1,
            body: <div>Schools adapter fields</div>
          }
        ]}
        sidebarCards={[
          {
            key: "sidebar",
            title: "Publish blockers",
            body: <div>Missing required shared fields</div>
          }
        ]}
        footer={<button type="button">Publish</button>}
      />
    );

    expect(screen.getByRole("heading", { name: "New Job" })).toBeInTheDocument();
    expect(screen.getByText("Schools")).toBeInTheDocument();
    expect(screen.getByText("Core schedule and ownership fields")).toBeInTheDocument();
    expect(screen.getAllByText("Schools adapter fields").length).toBeGreaterThan(0);
    expect(screen.getByText("Missing required shared fields")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("renders the shared job detail shell with common sections", () => {
    render(
      <SharedJobDetailShell
        eyebrow="Sports"
        title="SPT-2026-00042"
        summary="Shared summary, days, readiness, staffing, production, and activity."
        meta={[{ label: "At Risk", tone: "warning" }]}
        tabs={[
          { key: "summary", label: "Summary" },
          { key: "activity", label: "Activity" }
        ]}
        activeTab="summary"
        onSelectTab={() => {}}
        summaryCards={[
          { key: "summary", title: "Summary", body: <div>Department snapshot</div> },
          { key: "activity", title: "Activity", body: <div>Recent activity</div> }
        ]}
        body={<div>Shared detail body</div>}
      />
    );

    expect(screen.getByRole("heading", { name: "SPT-2026-00042" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByText("Department snapshot")).toBeInTheDocument();
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
  });

  it("renders the shared job list shell with saved views and filters", () => {
    render(
      <SharedJobListShell
        title="Jobs"
        summary="Shared list infrastructure for department workspaces."
        savedViews={<button type="button">Next 14 Days</button>}
        filters={<label>Department<input aria-label="Department filter" /></label>}
        content={<div>Shared jobs table</div>}
      />
    );

    expect(screen.getByRole("heading", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next 14 Days" })).toBeInTheDocument();
    expect(screen.getByLabelText("Department filter")).toBeInTheDocument();
    expect(screen.getByText("Shared jobs table")).toBeInTheDocument();
  });
});
