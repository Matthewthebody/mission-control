// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MissionControlAssistant } from "../components/home/MissionControlAssistant";

afterEach(() => {
  cleanup();
});

describe("MissionControlAssistant", () => {
  it("renders a safe, not-connected foundation with working suggestion chips and a real answer", async () => {
    render(<MissionControlAssistant token="token" />);

    expect(screen.getByText("Ask Mission Control")).toBeInTheDocument();
    expect(screen.getByText(/Preview/i)).toBeInTheDocument();

    const input = screen.getByRole("textbox", { name: /Ask Mission Control anything/i });
    expect(input).toHaveAttribute("placeholder", "Ask Mission Control anything…");

    // Suggestion chip populates the input (real action, not a dead button).
    fireEvent.click(screen.getByRole("button", { name: "Where are staffing gaps?" }));
    expect(input).toHaveValue("Where are staffing gaps?");

    // Submitting returns a real "not connected yet" answer (no dead action, no external call).
    fireEvent.click(screen.getByRole("button", { name: "Ask Mission Control" }));
    expect(await screen.findByText(/isn't connected yet/i)).toBeInTheDocument();
  });
});
