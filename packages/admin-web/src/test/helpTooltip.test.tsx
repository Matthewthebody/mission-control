// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpTooltip } from "../components/HelpTooltip";

afterEach(() => {
  cleanup();
});

describe("HelpTooltip", () => {
  it("renders a quiet help trigger and keeps the description accessible, revealed on interaction", () => {
    render(<HelpTooltip text="A readable team calendar for shifts, events, and shoots." />);

    const trigger = screen.getByRole("button", { name: "More information" });
    expect(trigger).toBeInTheDocument();

    // Description stays in the DOM for screen readers and is linked via aria-describedby.
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(screen.getByText(/A readable team calendar/i)).toBeInTheDocument();

    // Closed by default; clicking (tap) opens it; Escape closes it.
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Focus reveals it for keyboard users.
    fireEvent.focus(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});
