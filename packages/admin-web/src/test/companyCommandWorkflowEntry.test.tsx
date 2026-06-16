// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanyCommandHome } from "../home/CompanyCommandHome";
import { getHomeRole } from "../home/homeRoles";

describe("Company Command workflow entry point", () => {
  beforeEach(() => {
    window.location.hash = "#home";
  });
  afterEach(() => {
    cleanup();
  });

  it("surfaces a Leadership Board workflow command entry point instead of burying it under Admin", () => {
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    expect(screen.getByRole("heading", { name: "Workflow Command" })).toBeInTheDocument();

    // The builder entry routes to the canonical workflow-builder hash (not a dead Admin route).
    fireEvent.click(screen.getByRole("button", { name: /Open Workflow Command/i }));
    expect(window.location.hash).toBe("#project-tracking/workflow-templates");

    // The "test a job workflow" entry routes to Production Tracker where jobs are worked through statuses.
    render(<CompanyCommandHome role={getHomeRole("matthew")} />);
    fireEvent.click(screen.getAllByRole("button", { name: /Open Production Tracker/i })[0]);
    expect(window.location.hash).toBe("#project-tracking");
  });
});
