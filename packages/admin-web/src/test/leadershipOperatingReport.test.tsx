// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeadershipOperatingReport } from "../components/leadership/LeadershipOperatingReport";

const getProjectWorkflowCommandCenterMock = vi.fn();

vi.mock("../services/projectTracking", async () => {
  const actual = await vi.importActual<typeof import("../services/projectTracking")>("../services/projectTracking");
  return {
    ...actual,
    getProjectWorkflowCommandCenter: (...args: unknown[]) => getProjectWorkflowCommandCenterMock(...args)
  };
});

afterEach(() => {
  cleanup();
  getProjectWorkflowCommandCenterMock.mockReset();
});

describe("LeadershipOperatingReport", () => {
  it("renders the operating report from real command-center rows", async () => {
    getProjectWorkflowCommandCenterMock.mockResolvedValue({
      generated_at: "2026-05-01T12:00:00.000Z",
      view: "global",
      job_rows: []
    });

    render(<LeadershipOperatingReport token="token" />);

    expect(await screen.findByText("Leadership Operating Report")).toBeInTheDocument();
    expect(screen.getByText("Active Jobs by Stage")).toBeInTheDocument();
  });

  it("shows an honest error line, not a crash or fake metrics, when the data fails to load", async () => {
    getProjectWorkflowCommandCenterMock.mockRejectedValue(new Error("network"));

    render(<LeadershipOperatingReport token="token" />);

    expect(await screen.findByText(/operating report is unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText("Leadership Operating Report")).not.toBeInTheDocument();
    expect(screen.queryByText("Active Jobs by Stage")).not.toBeInTheDocument();
  });
});
