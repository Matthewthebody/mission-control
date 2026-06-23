// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HelpTooltip } from "../components/HelpTooltip";

// Global UX correction — the single standardized Help control. Help content is hidden until the user
// asks for it (click or keyboard), a brief hover preview is offered, Escape closes AND returns focus to
// the trigger, clicking outside closes, multiple instances are independent, and long content scrolls.

afterEach(() => cleanup());

describe("HelpTooltip — standardized Help control", () => {
  it("(1) keeps the description accessible (aria-describedby) but visually hidden by default", () => {
    render(<HelpTooltip text="A readable team calendar for shifts, events, and shoots." label="Help: Schedule" />);
    const trigger = screen.getByRole("button", { name: "Help: Schedule" });
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const bubble = screen.getByText(/A readable team calendar/i);
    expect(bubble).toHaveAttribute("id", describedBy); // linked for screen readers
    expect(bubble).not.toBeVisible(); // visually hidden — this is what de-clutters the page
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("(2) the ? button reveals the correct explanation on click", () => {
    render(<HelpTooltip text="Counts are server-computed." label="Help: Production" />);
    const trigger = screen.getByRole("button", { name: "Help: Production" });
    fireEvent.click(trigger);
    expect(screen.getByText("Counts are server-computed.")).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("(3) the trigger is a real keyboard-operable button (Enter/Space activate natively) and is focusable", () => {
    render(<HelpTooltip text="x" label="Help: Production" />);
    const trigger = screen.getByRole("button", { name: "Help: Production" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });

  it("(4) Escape closes it and (5) leaves focus on the trigger (focus never lost to the body)", () => {
    render(<HelpTooltip text="x" label="Help: Production" />);
    const trigger = screen.getByRole("button", { name: "Help: Production" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("(6) a brief hover preview works but is not the only way in", () => {
    render(<HelpTooltip text="hover me" label="Help: Production" />);
    const trigger = screen.getByRole("button", { name: "Help: Production" });
    fireEvent.mouseEnter(trigger);
    expect(screen.getByText("hover me")).toBeVisible();
    fireEvent.mouseLeave(trigger);
    expect(screen.getByText("hover me")).not.toBeVisible();
  });

  it("(7) clicking outside closes it (touch/click dismiss)", () => {
    render(
      <div>
        <HelpTooltip text="x" label="Help: Production" />
        <button type="button">Elsewhere</button>
      </div>
    );
    const trigger = screen.getByRole("button", { name: "Help: Production" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("(8) multiple Help controls are independent — opening one leaves others closed, distinct ids", () => {
    render(
      <div>
        <HelpTooltip text="Alpha help" label="Help: Alpha" />
        <HelpTooltip text="Beta help" label="Help: Beta" />
      </div>
    );
    const a = screen.getByRole("button", { name: "Help: Alpha" });
    const b = screen.getByRole("button", { name: "Help: Beta" });
    fireEvent.click(a);
    expect(a).toHaveAttribute("aria-expanded", "true");
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(a.getAttribute("aria-describedby")).not.toBe(b.getAttribute("aria-describedby"));
  });

  it("(9) long content scrolls inside the popover instead of overflowing the page/tablet layout", () => {
    render(<HelpTooltip text={"line ".repeat(400)} label="Help: Long" />);
    const bubble = screen.getByText(/line line/);
    expect(bubble).toHaveStyle({ overflowY: "auto" });
    expect(bubble.style.maxHeight).toBeTruthy();
  });
});
