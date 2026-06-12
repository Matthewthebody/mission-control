// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpTooltip } from "../components/HelpTooltip";

afterEach(() => {
  cleanup();
});

describe("HelpTooltip", () => {
  it("keeps the description accessible but visually hidden by default, revealed only on interaction", () => {
    render(<HelpTooltip text="A readable team calendar for shifts, events, and shoots." />);

    const trigger = screen.getByRole("button", { name: "More information" });
    expect(trigger).toBeInTheDocument();

    // Description stays in the DOM for screen readers and is linked via aria-describedby.
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const bubble = screen.getByText(/A readable team calendar/i);
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveAttribute("id", describedBy);

    // It is NOT visibly rendered by default — this is what makes the page cleaner.
    expect(bubble).not.toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Tap/click reveals it; Escape hides it again.
    fireEvent.click(trigger);
    expect(bubble).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(bubble).not.toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Hover reveals it.
    fireEvent.mouseEnter(trigger);
    expect(bubble).toBeVisible();
    fireEvent.mouseLeave(trigger);
    expect(bubble).not.toBeVisible();

    // Keyboard focus reveals it.
    fireEvent.focus(trigger);
    expect(bubble).toBeVisible();
    fireEvent.blur(trigger);
    expect(bubble).not.toBeVisible();
  });
});
