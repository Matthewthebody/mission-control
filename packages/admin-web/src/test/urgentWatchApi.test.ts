import { describe, expect, it, vi } from "vitest";
import { applyUrgentWatchAction, getUrgentWatchDetail, getUrgentWatchWorkspace } from "../services/urgentWatchApi";

const getExceptionWorkspaceMock = vi.fn();
const getExceptionDetailMock = vi.fn();
const applyExceptionActionMock = vi.fn();

vi.mock("../services/exceptionsApi", () => ({
  getExceptionWorkspace: (...args: unknown[]) => getExceptionWorkspaceMock(...args),
  getExceptionDetail: (...args: unknown[]) => getExceptionDetailMock(...args),
  applyExceptionAction: (...args: unknown[]) => applyExceptionActionMock(...args)
}));

describe("urgentWatchApi compatibility aliases", () => {
  it("delegates legacy urgent-watch workspace/detail/action helpers to the canonical exceptions API", async () => {
    getExceptionWorkspaceMock.mockResolvedValueOnce({ items: [], summary: { open_count: 0 } });
    getExceptionDetailMock.mockResolvedValueOnce({ item: { id: "exception-1" } });
    applyExceptionActionMock.mockResolvedValueOnce({ item: { id: "exception-1", status: "handled" } });

    await expect(getUrgentWatchWorkspace("token-demo", { date: "2026-04-24" })).resolves.toEqual({
      items: [],
      summary: { open_count: 0 }
    });
    await expect(getUrgentWatchDetail("token-demo", "exception-1")).resolves.toEqual({
      item: { id: "exception-1" }
    });
    await expect(
      applyUrgentWatchAction("token-demo", "exception-1", {
        action: "mark_handled",
        note: "Handled from legacy alias."
      })
    ).resolves.toEqual({
      item: { id: "exception-1", status: "handled" }
    });

    expect(getExceptionWorkspaceMock).toHaveBeenCalledWith("token-demo", { date: "2026-04-24" });
    expect(getExceptionDetailMock).toHaveBeenCalledWith("token-demo", "exception-1");
    expect(applyExceptionActionMock).toHaveBeenCalledWith("token-demo", "exception-1", {
      action: "mark_handled",
      note: "Handled from legacy alias."
    });
  });
});
