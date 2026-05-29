import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreCallContextPanel } from "../components/PreCallContextPanel";
import type { PreCallContextDefinition } from "../preCallContextTypes";

const listRecordResourcesMock = vi.fn();

vi.mock("../services/recordResourcesApi", () => ({
  listRecordResources: (...args: unknown[]) => listRecordResourcesMock(...args)
}));

function buildDefinition(overrides: Partial<PreCallContextDefinition> = {}): PreCallContextDefinition {
  return {
    title: "Pre-Call Context",
    summary: "Review the key operational details before jumping into Teams.",
    callReason: "Confirm setup timing and parking before staff arrive.",
    sections: [
      {
        key: "summary",
        title: "Job Summary",
        items: [
          {
            label: "Job",
            value: "JOB-001 | Metro Football Media Day",
            detail: "Metro Football Club"
          }
        ]
      }
    ],
    resourceTarget: {
      objectType: "job",
      objectId: "job-1",
      title: "Linked Files"
    },
    ...overrides
  };
}

describe("PreCallContextPanel", () => {
  beforeEach(() => {
    listRecordResourcesMock.mockReset();
    listRecordResourcesMock.mockResolvedValue({
      object: { object_type: "job", object_id: "job-1", label: "Job" },
      access: { can_view: true, can_manage: false },
      summary: { total_items: 1, uploaded_file_count: 1, external_link_count: 0 },
      items: [
        {
          id: "resource-1",
          title: "Parking Map",
          resource_type: "file",
          category: "support_document",
          reference_kind: "uploaded_file",
          provider: "internal_upload",
          description: "Staff parking and load-in path",
          file_name: "parking-map.pdf",
          content_type: "application/pdf",
          file_size_bytes: 1024,
          url: "https://files.example.test/parking-map.pdf",
          uploaded_by_user_id: "user-1",
          uploaded_by_name: "Alex Owner",
          created_at: "2026-04-03T12:00:00.000Z",
          can_remove: false,
          linked_objects: [{ object_type: "job", object_id: "job-1" }]
        }
      ]
    });
  });

  it("renders call context sections and linked files", async () => {
    render(<PreCallContextPanel token="token-demo" definition={buildDefinition()} />);

    expect(screen.getByText("Confirm setup timing and parking before staff arrive.")).toBeInTheDocument();
    expect(screen.getByText("Job Summary")).toBeInTheDocument();
    expect(screen.getByText("JOB-001 | Metro Football Media Day")).toBeInTheDocument();

    await waitFor(() => expect(listRecordResourcesMock).toHaveBeenCalledWith("token-demo", "job", "job-1"));
    expect(await screen.findByRole("link", { name: "Parking Map" })).toHaveAttribute(
      "href",
      "https://files.example.test/parking-map.pdf"
    );
  });

  it("handles empty and no-resource state gracefully", async () => {
    listRecordResourcesMock.mockResolvedValueOnce({
      object: { object_type: "job", object_id: "job-1", label: "Job" },
      access: { can_view: true, can_manage: false },
      summary: { total_items: 0, uploaded_file_count: 0, external_link_count: 0 },
      items: []
    });

    render(
      <PreCallContextPanel
        token="token-demo"
        definition={buildDefinition({
          callReason: null,
          sections: [
            {
              key: "empty",
              title: "Open Issues",
              items: [],
              emptyLabel: "No open issues are attached to this job."
            }
          ]
        })}
      />
    );

    expect(await screen.findByText("No open issues are attached to this job.")).toBeInTheDocument();
    expect(await screen.findByText("No linked files are attached to this record yet.")).toBeInTheDocument();
  });
});
