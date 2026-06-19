// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanyCommandHome } from "../home/CompanyCommandHome";
import { getHomeRole } from "../home/homeRoles";

// Phase 1 actionability contract: every enabled Company Command card opens the
// exact surface its label promises, and a surface that is not connected renders a
// disabled state instead of a dead/misleading drilldown.
describe("Company Command card actionability", () => {
  beforeEach(() => {
    window.location.hash = "#home";
  });
  afterEach(() => {
    cleanup();
  });

  it("routes Late / Not Clocked In to attendance, not the staffing board", () => {
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    fireEvent.click(screen.getByRole("button", { name: /Late \/ Not Clocked In/i }));
    expect(window.location.hash).toBe("#employees/attendance");
  });

  it("routes Client Issues to client success, not the executive dashboard", () => {
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    fireEvent.click(screen.getByRole("button", { name: /Client Issues/i }));
    expect(window.location.hash).toBe("#client-command-center");
  });

  it("keeps Staffing Risk on the staffing board with its area focus", () => {
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    fireEvent.click(screen.getByRole("button", { name: /Staffing Risk/i }));
    expect(window.location.hash).toBe("#operations/staffing?area=staffing");
  });

  it("disables the Weather Watch card because no live weather provider is connected", () => {
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    // There is no enabled control for weather — only a disabled card stating why.
    expect(screen.queryByRole("button", { name: /Weather Watch/i })).toBeNull();
    expect(screen.getByText(/No live weather provider connected/i)).toBeInTheDocument();
  });

  it("gives the attendance risk panel a real Open Attendance action", () => {
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    fireEvent.click(screen.getByRole("button", { name: /Open Attendance/i }));
    expect(window.location.hash).toBe("#employees/attendance");
  });

  it("opens the Urgent Window from On Fire focused on unresolved (open) items", () => {
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    fireEvent.click(screen.getByRole("button", { name: /On Fire/i }));
    expect(window.location.hash).toBe("#urgent-window?status=open");
  });
});
