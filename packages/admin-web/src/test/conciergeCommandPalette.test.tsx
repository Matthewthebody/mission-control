// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConciergeCommandPalette } from "../components/concierge/ConciergeCommandPalette";

const EMPTY_FILTERS = {
  department: null,
  entity_types: [],
  status: null,
  owner: null,
  assignee: null,
  org: null,
  date: null,
  risk: null,
  has_any: []
} as const;

const searchConciergeMock = vi.fn();
const getConciergeSuggestionsMock = vi.fn();
const getConciergeRecentSearchesMock = vi.fn();
const getConciergeSavedSearchesMock = vi.fn();
const createConciergeSavedSearchMock = vi.fn();
const updateConciergeSavedSearchMock = vi.fn();
const deleteConciergeSavedSearchMock = vi.fn();
const lookupConciergeResultMock = vi.fn();
const recordConciergeRecentSearchMock = vi.fn();

vi.mock("../services/conciergeApi", () => ({
  searchConcierge: (...args: unknown[]) => searchConciergeMock(...args),
  getConciergeSuggestions: (...args: unknown[]) => getConciergeSuggestionsMock(...args),
  getConciergeRecentSearches: (...args: unknown[]) => getConciergeRecentSearchesMock(...args),
  getConciergeSavedSearches: (...args: unknown[]) => getConciergeSavedSearchesMock(...args),
  createConciergeSavedSearch: (...args: unknown[]) => createConciergeSavedSearchMock(...args),
  updateConciergeSavedSearch: (...args: unknown[]) => updateConciergeSavedSearchMock(...args),
  deleteConciergeSavedSearch: (...args: unknown[]) => deleteConciergeSavedSearchMock(...args),
  lookupConciergeResult: (...args: unknown[]) => lookupConciergeResultMock(...args),
  recordConciergeRecentSearch: (...args: unknown[]) => recordConciergeRecentSearchMock(...args)
}));

describe("ConciergeCommandPalette", () => {
  beforeEach(() => {
    searchConciergeMock.mockReset();
    getConciergeSuggestionsMock.mockReset();
    getConciergeRecentSearchesMock.mockReset();
    getConciergeSavedSearchesMock.mockReset();
    createConciergeSavedSearchMock.mockReset();
    updateConciergeSavedSearchMock.mockReset();
    deleteConciergeSavedSearchMock.mockReset();
    lookupConciergeResultMock.mockReset();
    recordConciergeRecentSearchMock.mockReset();
    window.location.hash = "#home";
  });

  afterEach(() => {
    cleanup();
  });

  it("supports arrow-key selection and Enter to open the active result", async () => {
    searchConciergeMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      query: "Monticello",
      total_results: 2,
      access_limited: false,
      sections: [
        {
          entity_type: "organization",
          title: "Organizations",
          total: 1,
          results: [
            {
              search_index_id: "search-org-1",
              entity_type: "organization",
              entity_id: "org-1",
              title: "Monticello High School",
              subtitle: "Directory record",
              body: "Directory entry.",
              snippet: null,
              status: "active",
              department: "schools",
              org_id: "org-1",
              org_name: "Monticello High School",
              primary_date: null,
              risk_level: null,
              deep_link: "#directory/organizations/org-1",
              tone: "info",
              score: 200,
              has_notes: true,
              has_alerts: false,
              has_staffing_gap: false,
              quick_actions: [{ key: "open", label: "Open", deep_link: "#directory/organizations/org-1" }]
            }
          ]
        },
        {
          entity_type: "task",
          title: "Tasks",
          total: 1,
          results: [
            {
              search_index_id: "search-task-1",
              entity_type: "task",
              entity_id: "task-1",
              title: "Monticello follow-up",
              subtitle: "Confirm roster",
              body: "Task body.",
              snippet: "Confirm roster and staffing details for Monticello.",
              status: "in_progress",
              department: "production",
              org_id: "org-1",
              org_name: "Monticello High School",
              primary_date: "2026-04-03T14:00:00.000Z",
              risk_level: "warning",
              deep_link: "#tasks/task-1",
              tone: "warning",
              score: 150,
              has_notes: false,
              has_alerts: true,
              has_staffing_gap: true,
              quick_actions: [
                { key: "open", label: "Open", deep_link: "#tasks/task-1" },
                { key: "create_task", label: "Create Task", deep_link: "#tasks/new?department=production" }
              ]
            }
          ]
        }
      ],
      applied_filters: { ...EMPTY_FILTERS },
      took_ms: 7
    });
    getConciergeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    getConciergeRecentSearchesMock.mockResolvedValue({ recent_searches: [], product_name: "Kemmetmueller Concierge", took_ms: 1 });
    getConciergeSavedSearchesMock.mockResolvedValue({ saved_searches: [], product_name: "Kemmetmueller Concierge", took_ms: 1 });
    lookupConciergeResultMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      result: null,
      took_ms: 1
    });
    recordConciergeRecentSearchMock.mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ConciergeCommandPalette token="token-demo" open mode="overlay" mobile={false} initialQuery="Monticello" onClose={onClose} />
    );

    const taskResult = await screen.findByRole("button", { name: /Monticello follow-up/i });
    expect(taskResult).toBeInTheDocument();
    const organizationResult = screen
      .getAllByRole("button", { name: /Monticello High School/i })
      .find((button) => button.textContent?.includes("Directory record"));
    expect(organizationResult).toBeDefined();

    const dialog = screen.getByRole("dialog", { name: "Kemmetmueller Concierge" });
    await waitFor(() => {
      expect(organizationResult as HTMLElement).toHaveClass("is-active");
    });

    fireEvent.keyDown(dialog, { key: "ArrowDown" });

    await waitFor(() => {
      expect(taskResult).toHaveClass("is-active");
    });

    fireEvent.keyDown(dialog, { key: "Enter" });

    await waitFor(() => {
      expect(window.location.hash).toBe("#tasks/task-1");
    });
    expect(recordConciergeRecentSearchMock).toHaveBeenCalledWith(
      "token-demo",
      expect.objectContaining({
        query: "Monticello",
        selected_search_index_id: "search-task-1"
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("shows saved searches before typing and applies them with a touch update", async () => {
    getConciergeRecentSearchesMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      recent_searches: [],
      took_ms: 1
    });
    getConciergeSavedSearchesMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      saved_searches: [
        {
          id: "saved-1",
          name: "Blocked Production",
          query: "blocked production",
          filters: {
            ...EMPTY_FILTERS,
            department: "production",
            status: "blocked",
            has_any: ["alerts"]
          },
          pinned: true,
          created_at: "2026-04-03T09:00:00.000Z",
          updated_at: "2026-04-03T09:00:00.000Z",
          last_used_at: "2026-04-03T09:30:00.000Z"
        }
      ],
      took_ms: 1
    });
    getConciergeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    searchConciergeMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      query: "blocked production",
      total_results: 0,
      access_limited: false,
      sections: [],
      applied_filters: {
        ...EMPTY_FILTERS,
        department: "production",
        status: "blocked",
        has_any: ["alerts"]
      },
      took_ms: 3
    });
    updateConciergeSavedSearchMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      saved_searches: [
        {
          id: "saved-1",
          name: "Blocked Production",
          query: "blocked production",
          filters: {
            ...EMPTY_FILTERS,
            department: "production",
            status: "blocked",
            has_any: ["alerts"]
          },
          pinned: true,
          created_at: "2026-04-03T09:00:00.000Z",
          updated_at: "2026-04-03T10:00:00.000Z",
          last_used_at: "2026-04-03T10:00:00.000Z"
        }
      ],
      took_ms: 2
    });
    lookupConciergeResultMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      result: null,
      took_ms: 1
    });

    render(<ConciergeCommandPalette token="token-demo" open mode="overlay" mobile={false} />);

    const savedButton = await screen.findByRole("button", { name: /Blocked Production/i });
    fireEvent.click(savedButton);

    await waitFor(() => {
      expect(updateConciergeSavedSearchMock).toHaveBeenCalledWith("token-demo", "saved-1", { touch: true });
    });
    await waitFor(() => {
      expect(searchConciergeMock).toHaveBeenCalledWith(
        "token-demo",
        expect.objectContaining({
          q: "blocked production",
          department: "production",
          status: "blocked",
          has_any: ["alerts"]
        })
      );
    });
  });

  it("closes on Escape and uses the mobile presentation variant", () => {
    getConciergeRecentSearchesMock.mockResolvedValue({ recent_searches: [], product_name: "Kemmetmueller Concierge", took_ms: 1 });
    getConciergeSavedSearchesMock.mockResolvedValue({ saved_searches: [], product_name: "Kemmetmueller Concierge", took_ms: 1 });
    const onClose = vi.fn();

    render(<ConciergeCommandPalette token="token-demo" open mode="overlay" mobile initialQuery="" onClose={onClose} />);

    const dialog = screen.getByRole("dialog", { name: "Kemmetmueller Concierge" });
    expect(dialog).toHaveClass("concierge-overlay--mobile");
    expect(document.querySelector(".concierge-panel--mobile")).toBeTruthy();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
