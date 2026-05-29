import { apiFetch } from "../api";
import type {
  ResourceLibraryApprovalStatus,
  ResourceLibraryBestReferenceCategory,
  ResourceLibraryCategory,
  ResourceLibraryItem,
  ResourceLibraryVisibilityScope
} from "../types";

export type ResourceLibraryReviewInput = {
  approval_status?: ResourceLibraryApprovalStatus;
  visibility_scope?: ResourceLibraryVisibilityScope;
  category?: ResourceLibraryCategory;
  issue_type?: string | null;
  note?: string | null;
  best_reference_candidate?: boolean;
  is_best_reference?: boolean;
  best_reference_category?: ResourceLibraryBestReferenceCategory | null;
  review_note?: string | null;
};

export async function reviewResourceLibraryItem(token: string, itemId: string, input: ResourceLibraryReviewInput) {
  return apiFetch<ResourceLibraryItem>(`/api/resource-library/items/${encodeURIComponent(itemId)}/review`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}
