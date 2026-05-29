import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecordResourcesPanel } from "../components/RecordResourcesPanel";
import type { RecordResourcesResponse } from "../recordResourcesTypes";

const listRecordResourcesMock = vi.fn();
const createRecordResourceMock = vi.fn();
const deleteRecordResourceMock = vi.fn();
const uploadRecordResourceFileMock = vi.fn();

vi.mock("../services/recordResourcesApi", () => ({
  listRecordResources: (...args: unknown[]) => listRecordResourcesMock(...args),
  createRecordResource: (...args: unknown[]) => createRecordResourceMock(...args),
  deleteRecordResource: (...args: unknown[]) => deleteRecordResourceMock(...args),
  uploadRecordResourceFile: (...args: unknown[]) => uploadRecordResourceFileMock(...args)
}));

function buildResponse(overrides: Partial<ReturnType<typeof baseResponse>> = {}) {
  return {
    ...baseResponse(),
    ...overrides
  };
}

function baseResponse(): RecordResourcesResponse {
  return {
    object: {
      object_type: "job" as const,
      object_id: "job-1",
      label: "JOB-001 | North High"
    },
    access: {
      can_view: true,
      can_manage: true
    },
    summary: {
      total_items: 1,
      uploaded_file_count: 0,
      external_link_count: 1
    },
    items: [
      {
        id: "resource-1",
        title: "North High SOP",
        resource_type: "document" as const,
        category: "sop_reference" as const,
        reference_kind: "external_link" as const,
        provider: "direct_url" as const,
        description: "Day-of operating notes",
        file_name: "North High SOP",
        content_type: null,
        file_size_bytes: null,
        url: "https://example.com/sop",
        uploaded_by_user_id: "user-1",
        uploaded_by_name: "Demo Leadership",
        created_at: "2026-04-03T10:00:00.000Z",
        can_remove: true,
        linked_objects: [{ object_type: "job" as const, object_id: "job-1" }]
      }
    ]
  };
}

describe("RecordResourcesPanel", () => {
  beforeEach(() => {
    listRecordResourcesMock.mockReset();
    createRecordResourceMock.mockReset();
    deleteRecordResourceMock.mockReset();
    uploadRecordResourceFileMock.mockReset();
    vi.stubGlobal("confirm", vi.fn(() => true));
    listRecordResourcesMock.mockResolvedValue(buildResponse());
  });

  it("renders attached resources and allows adding an external link", async () => {
    createRecordResourceMock.mockResolvedValue(baseResponse().items[0]);
    listRecordResourcesMock
      .mockResolvedValueOnce(buildResponse({ items: [], summary: { total_items: 0, uploaded_file_count: 0, external_link_count: 0 } }))
      .mockResolvedValueOnce(buildResponse({
        items: [
          {
            ...baseResponse().items[0],
            id: "resource-link-2",
            title: "Setup Packet"
          }
        ],
        summary: {
          total_items: 1,
          uploaded_file_count: 0,
          external_link_count: 1
        }
      }));

    render(<RecordResourcesPanel token="token" objectType="job" objectId="job-1" />);

    expect(await screen.findByText("No resources are attached yet. Add files or links that help the team work this record.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add link" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Setup Packet" } });
    fireEvent.change(screen.getByLabelText("URL"), { target: { value: "https://example.com/setup-packet" } });
    fireEvent.click(screen.getByRole("button", { name: "Save link" }));

    await waitFor(() =>
      expect(createRecordResourceMock).toHaveBeenCalledWith(
        "token",
        "job",
        "job-1",
        expect.objectContaining({
          title: "Setup Packet",
          url: "https://example.com/setup-packet"
        })
      )
    );
    expect(await screen.findByText("Link added.")).toBeInTheDocument();
    expect(await screen.findByText("Setup Packet")).toBeInTheDocument();
  });

  it("uploads a file and allows removing a managed resource", async () => {
    uploadRecordResourceFileMock.mockResolvedValue({
      storage_key: "tenants/demo/uploads/file.pdf",
      url: "https://example.com/file.pdf",
      content_type: "application/pdf",
      file_size_bytes: 2048
    });
    createRecordResourceMock.mockResolvedValue(baseResponse().items[0]);
    deleteRecordResourceMock.mockResolvedValue(undefined);
    listRecordResourcesMock
      .mockResolvedValueOnce(buildResponse())
      .mockResolvedValueOnce(buildResponse({
        items: [
          {
            ...baseResponse().items[0],
            id: "resource-upload-1",
            title: "Contract Packet",
            reference_kind: "uploaded_file" as const,
            provider: "internal_upload" as const,
            url: "https://example.com/file.pdf"
          }
        ],
        summary: {
          total_items: 1,
          uploaded_file_count: 1,
          external_link_count: 0
        }
      }))
      .mockResolvedValueOnce(buildResponse({ items: [], summary: { total_items: 0, uploaded_file_count: 0, external_link_count: 0 } }));

    render(<RecordResourcesPanel token="token" objectType="job" objectId="job-1" />);

    expect(await screen.findByText("North High SOP")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Upload file" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Contract Packet" } });

    const file = new File(["contract"], "contract.pdf", { type: "application/pdf" });
    fireEvent.change(screen.getByLabelText("File"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));

    await waitFor(() => expect(uploadRecordResourceFileMock).toHaveBeenCalledWith("token", file, "job", "job-1"));
    expect(await screen.findByText("File uploaded.")).toBeInTheDocument();
    expect(await screen.findByText("Contract Packet")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(deleteRecordResourceMock).toHaveBeenCalledWith("token", "job", "job-1", "resource-upload-1"));
  });
});
