// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WeatherImpactPanel } from "../home/WeatherImpactPanel";
import { buildCompanyCommandCards } from "../home/homeDemoData";
import { resolveActionTarget } from "../home/actionTargets";

// June 18 — Weather and Client Issues are honestly unavailable: no fake count, no enabled CTA, no
// demo fallback, no generic Client Success route, and travel heuristics are never labeled Weather.

afterEach(() => cleanup());

describe("Weather + Client Issues honesty", () => {
  it("Weather Impact panel shows 'Weather provider not connected' with no count and no fabricated forecast rows", () => {
    render(<WeatherImpactPanel emphasizedArea="schools" />);
    const panel = screen.getByRole("region", { name: "Weather impact" });
    const p = within(panel);
    expect(p.getByText(/Weather provider not connected/i)).toBeInTheDocument();
    expect(p.getByText("Not connected")).toBeInTheDocument();
    // no count badge, no forecast rows, no drilldown link (the section Help toggle is allowed)
    expect(panel.querySelector(".home-section-header__count")).toBeNull();
    expect(panel.querySelector(".home-weather-row")).toBeNull();
    expect(p.queryByRole("link")).not.toBeInTheDocument();
    // travel pressure is never presented here as weather
    expect(p.queryByText(/travel/i)).toBeInTheDocument(); // only the "tracked separately" disclaimer
    expect(p.queryByText(/rain|wind|storm|forecast .*°|lightning/i)).not.toBeInTheDocument();
  });

  it("the Weather command card is an unavailable target — no fake count, no enabled CTA", () => {
    const weather = buildCompanyCommandCards().find((c) => c.id === "weather-watch");
    expect(weather).toBeTruthy();
    expect(weather!.dataSource).toBe("unavailable");
    const resolved = resolveActionTarget(weather!.target);
    expect(resolved.available).toBe(false); // disabled — never a dead enabled control
    expect((resolved as { reason: string }).reason).toMatch(/weather provider/i);
  });

  it("the Client Issues command card is an unavailable target — no fake count, no generic Client Success route", () => {
    const clientIssues = buildCompanyCommandCards().find((c) => c.id === "client-issues");
    expect(clientIssues).toBeTruthy();
    expect(clientIssues!.dataSource).toBe("unavailable");
    expect(clientIssues!.value).toBe("—"); // no fabricated number
    const resolved = resolveActionTarget(clientIssues!.target);
    expect(resolved.available).toBe(false); // disabled — no route to a generic Client Success page
    expect((resolved as { reason: string }).reason).toMatch(/client-case feed/i);
  });
});
