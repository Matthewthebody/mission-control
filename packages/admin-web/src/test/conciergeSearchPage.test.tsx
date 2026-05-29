// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConciergeSearchPage } from "../pages/ConciergeSearchPage";

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

describe("ConciergeSearchPage", () => {
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
  });

  afterEach(() => {
    cleanup();
  });

  it("renders grouped Phase 2 results and deep-links to the selected record", async () => {
    window.location.hash = "#search?q=Monticello";
    getConciergeRecentSearchesMock.mockResolvedValue({ product_name: "Kemmetmueller Concierge", recent_searches: [], took_ms: 1 });
    getConciergeSavedSearchesMock.mockResolvedValue({ product_name: "Kemmetmueller Concierge", saved_searches: [], took_ms: 1 });
    getConciergeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    searchConciergeMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      query: "Monticello",
      total_results: 2,
      access_limited: false,
      interpreted_intent: {
        kind: "contact_lookup",
        confidence: 0.96,
        subject: "Monticello",
        person: null,
        department: null,
        date: null,
        rationale: "The query is asking for a contact tied to a specific account."
      },
      answer_cards: [
        {
          id: "answer-1",
          kind: "contact_lookup",
          title: "Monticello High School primary contact is Jane Smith",
          summary: "Activities Director | jane@example.com",
          tone: "info",
          confidence: 0.96,
          metrics: [
            { label: "Role", value: "Activities Director" },
            { label: "Email", value: "jane@example.com" }
          ],
          linked_result_ids: ["search-org-1"],
          actions: [{ key: "open", label: "Open Contact", deep_link: "#directory/contacts?view=contacts&contact=contact-1&tab=relationships" }]
        }
      ],
      related_clusters: [
        {
          id: "cluster-1",
          title: "Monticello related context",
          summary: "1 organization | 1 task",
          tone: "info",
          results: [
            {
              search_index_id: "search-org-1",
              entity_type: "organization",
              entity_id: "org-1",
              title: "Monticello High School",
              subtitle: "Main directory record",
              body: "Primary school account for Monticello.",
              snippet: null,
              status: "active",
              department: "schools",
              org_id: "org-1",
              org_name: "Monticello High School",
              primary_date: null,
              risk_level: null,
              deep_link: "#directory/organizations/org-1",
              tone: "info",
              score: 182,
              has_notes: true,
              has_alerts: false,
              has_staffing_gap: false,
              quick_actions: [{ key: "open", label: "Open", deep_link: "#directory/organizations/org-1" }]
            }
          ]
        }
      ],
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
              subtitle: "Main directory record",
              body: "Primary school account for Monticello.",
              snippet: null,
              status: "active",
              department: "schools",
              org_id: "org-1",
              org_name: "Monticello High School",
              primary_date: null,
              risk_level: null,
              deep_link: "#directory/organizations/org-1",
              tone: "info",
              score: 182,
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
              subtitle: "Confirm final roster",
              body: "Assigned to Spencer Demo.",
              snippet: "...Confirm final roster before production release...",
              status: "in_progress",
              department: "production",
              org_id: "org-1",
              org_name: "Monticello High School",
              primary_date: "2026-04-03T14:00:00.000Z",
              risk_level: "warning",
              deep_link: "#tasks/task-1",
              tone: "warning",
              score: 141,
              has_notes: false,
              has_alerts: true,
              has_staffing_gap: true,
              quick_actions: [{ key: "open", label: "Open", deep_link: "#tasks/task-1" }]
            }
          ]
        }
      ],
      applied_filters: { ...EMPTY_FILTERS },
      took_ms: 12
    });
    lookupConciergeResultMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      result: {
        search_index_id: "search-org-1",
        entity_type: "organization",
        entity_id: "org-1",
        title: "Monticello High School",
        subtitle: "Main directory record",
        body: "Primary school account for Monticello.",
        snippet: null,
        status: "active",
        department: "schools",
        org_id: "org-1",
        org_name: "Monticello High School",
        primary_date: null,
        risk_level: null,
        deep_link: "#directory/organizations/org-1",
        tone: "info",
        score: 182,
        has_notes: true,
        has_alerts: false,
        has_staffing_gap: false,
        quick_actions: [{ key: "open", label: "Open", deep_link: "#directory/organizations/org-1" }]
      },
      took_ms: 2
    });
    recordConciergeRecentSearchMock.mockResolvedValue(undefined);

    render(<ConciergeSearchPage token="token-demo" />);

    expect(await screen.findByText(/primary contact is Jane Smith/i)).toBeInTheDocument();
    expect(screen.getByText(/Monticello related context/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Monticello follow-up/i })).toBeInTheDocument();
    expect(searchConciergeMock).toHaveBeenCalledWith(
      "token-demo",
      expect.objectContaining({
        q: "Monticello",
        limit: 24
      })
    );

    fireEvent.click(screen.getByRole("button", { name: /Monticello follow-up/i }));

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
  });

  it("shows saved and recent searches before a query is entered", async () => {
    window.location.hash = "#search";
    getConciergeRecentSearchesMock.mockResolvedValue({
      product_name: "Kemmetmueller Concierge",
      recent_searches: [
        {
          id: "recent-1",
          query: "Cooper High School",
          last_used_at: "2026-04-01T12:00:00.000Z",
          use_count: 3
        }
      ],
      took_ms: 3
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
            status: "blocked"
          },
          pinned: true,
          created_at: "2026-04-03T09:00:00.000Z",
          updated_at: "2026-04-03T09:00:00.000Z",
          last_used_at: "2026-04-03T09:30:00.000Z"
        }
      ],
      took_ms: 3
    });
    getConciergeSuggestionsMock.mockResolvedValue({ suggestions: [] });

    render(<ConciergeSearchPage token="token-demo" />);

    expect(await screen.findByText(/Search records, notes, staffing, alerts, and post-shoot context from anywhere/i)).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Blocked Production/i })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Cooper High School/i })).toBeInTheDocument();
    expect(searchConciergeMock).not.toHaveBeenCalled();
  });
});
