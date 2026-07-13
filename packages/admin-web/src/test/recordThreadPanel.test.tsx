// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordThreadPanel } from "../components/RecordThreadPanel";

const apiFetchMock = vi.fn();
vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args) };
});

const emptyView = {
  entity_type: "job",
  entity_id: "job-1",
  entity_label: "Fixture Job",
  thread_id: null,
  messages: []
};

const postedView = {
  ...emptyView,
  thread_id: "thread-1",
  messages: [
    {
      id: "m1",
      thread_id: "thread-1",
      message_kind: "user_message",
      body: "Roster confirmed.",
      event_type: null,
      author_user_id: "u1",
      author_name: "Leadership User",
      mention_user_ids: [],
      attachment_refs: [],
      metadata: {},
      created_at: "2026-07-13T18:00:00.000Z"
    },
    {
      id: "m2",
      thread_id: "thread-1",
      message_kind: "system_event",
      body: null,
      event_type: "meeting_created",
      author_user_id: "u1",
      author_name: "Leadership User",
      mention_user_ids: [],
      attachment_refs: [],
      metadata: { join_url: "https://teams.example.com/join/abc" },
      created_at: "2026-07-13T18:05:00.000Z"
    }
  ]
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("RecordThreadPanel", () => {
  it("loads the thread, posts a message, and renders system events with their join link", async () => {
    apiFetchMock.mockImplementation(async (path: unknown, _token: unknown, options?: { method?: string }) => {
      if (String(path) === "/api/record-threads/job/job-1" && !options?.method) {
        return emptyView;
      }
      if (String(path) === "/api/record-threads/job/job-1/messages" && options?.method === "POST") {
        return postedView;
      }
      throw new Error(`unexpected call: ${String(path)}`);
    });

    render(<RecordThreadPanel token="token" objectType="job" objectId="job-1" title="Job Thread" />);
    expect(await screen.findByText("No messages yet. Start the record's thread below.")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New thread message"), { target: { value: "Roster confirmed." } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByText("Roster confirmed.")).toBeInTheDocument();
    expect(screen.getByText("Leadership User")).toBeInTheDocument();
    expect(screen.getByText("Teams meeting created")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join meeting" })).toHaveAttribute("href", "https://teams.example.com/join/abc");
  });

  it("hides itself entirely when the viewer lacks record access", async () => {
    apiFetchMock.mockRejectedValue(new Error("Forbidden"));
    const { container } = render(<RecordThreadPanel token="token" objectType="organization" objectId="org-1" />);
    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });
});
