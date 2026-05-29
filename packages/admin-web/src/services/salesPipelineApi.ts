import { apiFetch } from "../api";
import type {
  SalesEmailCommunicationRecord,
  SalesOpportunityDetail,
  SalesOpportunityListView,
  SalesOpportunityStage,
  SalesOpportunityStatus,
  SalesOpportunityType,
  SalesPipelineBoardView,
  SalesPipelineOwnerOption,
  SalesPipelineType
} from "../salesPipelineTypes";

export type SalesOpportunityUpsertInput = {
  organization_id: string;
  primary_contact_id?: string | null;
  owner_id?: string | null;
  opportunity_type: SalesOpportunityType;
  pipeline_type: SalesPipelineType;
  stage?: SalesOpportunityStage;
  estimated_value?: number | null;
  next_action_date?: string | null;
  last_touch_date?: string | null;
  last_verified_contact_date?: string | null;
  notes?: string | null;
  follow_up_date?: string | null;
};

export type SalesOpportunityUpdateInput = Partial<Omit<SalesOpportunityUpsertInput, "organization_id">>;

export type SalesEmailSendInput = {
  organization_id: string;
  opportunity_id?: string | null;
  contact_id?: string | null;
  template_id: string;
  subject?: string | null;
  body?: string | null;
  trigger_type?: "manual" | "automated";
};

export async function listSalesPipelineOwners(token: string) {
  const response = await apiFetch<{ owners: SalesPipelineOwnerOption[] }>("/api/sales/owners", token);
  return response.owners;
}

export async function getSalesPipelineBoard(
  token: string,
  filters: {
    pipelineType?: SalesPipelineType | "all";
    ownerId?: string | null;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.pipelineType && filters.pipelineType !== "all") {
    params.set("pipeline_type", filters.pipelineType);
  }
  if (filters.ownerId) {
    params.set("owner_id", filters.ownerId);
  }
  const query = params.toString();
  return apiFetch<SalesPipelineBoardView>(`/api/sales/board${query ? `?${query}` : ""}`, token);
}

export async function listSalesOpportunities(
  token: string,
  filters: {
    search?: string;
    pipelineType?: SalesPipelineType | "all";
    stage?: SalesOpportunityStage | "all";
    status?: SalesOpportunityStatus | "all";
    ownerId?: string | null;
    resurfacingOnly?: boolean;
  } = {}
) {
  const params = new URLSearchParams();
  if (filters.search?.trim()) {
    params.set("search", filters.search.trim());
  }
  if (filters.pipelineType && filters.pipelineType !== "all") {
    params.set("pipeline_type", filters.pipelineType);
  }
  if (filters.stage && filters.stage !== "all") {
    params.set("stage", filters.stage);
  }
  if (filters.status && filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.ownerId) {
    params.set("owner_id", filters.ownerId);
  }
  if (filters.resurfacingOnly) {
    params.set("resurfacing_only", "true");
  }
  const query = params.toString();
  return apiFetch<SalesOpportunityListView>(`/api/sales/opportunities${query ? `?${query}` : ""}`, token);
}

export async function getSalesOpportunityDetail(token: string, opportunityId: string) {
  return apiFetch<SalesOpportunityDetail>(`/api/sales/opportunities/${opportunityId}`, token);
}

export async function createSalesOpportunityRecord(token: string, input: SalesOpportunityUpsertInput) {
  return apiFetch<SalesOpportunityDetail>("/api/sales/opportunities", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateSalesOpportunityRecord(token: string, opportunityId: string, input: SalesOpportunityUpdateInput) {
  return apiFetch<SalesOpportunityDetail>(`/api/sales/opportunities/${opportunityId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function sendSalesEmailCommunication(token: string, input: SalesEmailSendInput) {
  return apiFetch<SalesEmailCommunicationRecord>("/api/sales/communications/send", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
