import { apiFetch } from "../api";
import type {
  AccountServiceType,
  ClientAccountDetail,
  ClientCommandCenterDashboard,
  ClientContactRole,
  ClientOrganizationType,
  ClientOwnerType
} from "../clientCommandCenterTypes";

export function getClientCommandCenterDashboard(token: string) {
  return apiFetch<ClientCommandCenterDashboard>("/api/client-command-center/dashboard", token);
}

export function getClientAccountDetail(token: string, accountId: string) {
  return apiFetch<ClientAccountDetail>(`/api/client-command-center/accounts/${accountId}`, token);
}

export function createClientOrganization(
  token: string,
  payload: {
    name: string;
    organization_type: ClientOrganizationType;
    status?: string;
    phone?: string | null;
    website?: string | null;
    notes?: string | null;
  }
) {
  return apiFetch<ClientAccountDetail>("/api/client-command-center/organizations", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createClientAccount(
  token: string,
  payload: {
    organization_id?: string | null;
    name: string;
    account_type: ClientOrganizationType;
    status?: string;
    main_phone?: string | null;
    office_phone?: string | null;
    website?: string | null;
    notes?: string | null;
  }
) {
  return apiFetch<ClientAccountDetail>("/api/client-command-center/accounts", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createClientContact(
  token: string,
  payload: {
    account_id?: string | null;
    organization_id?: string | null;
    first_name: string;
    last_name: string;
    display_name?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile_phone?: string | null;
    office_phone?: string | null;
    title?: string | null;
    preferred_contact_method?: "email" | "phone" | "text" | "unknown";
    allow_email?: boolean;
    allow_sms?: boolean;
    allow_phone?: boolean;
    do_not_contact?: boolean;
    sms_consent_status?: "unknown" | "opted_in" | "opted_out" | "not_eligible";
    sms_consent_source?: string | null;
    sms_consent_at?: string | null;
    sms_opted_out_at?: string | null;
    notes?: string | null;
  }
) {
  return apiFetch<{ id: string }>("/api/client-command-center/contacts", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function attachClientContactRelationship(
  token: string,
  payload: {
    contact_id: string;
    account_id?: string | null;
    organization_id?: string | null;
    roles: ClientContactRole[];
    is_primary?: boolean;
    notes?: string | null;
  }
) {
  return apiFetch<ClientAccountDetail>("/api/client-command-center/contact-relationships", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function assignClientOwner(
  token: string,
  payload: {
    account_id?: string | null;
    organization_id?: string | null;
    owner_user_id: string;
    owner_type: ClientOwnerType;
    notes?: string | null;
  }
) {
  return apiFetch<ClientAccountDetail | { id: string }>("/api/client-command-center/owners", token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function upsertClientAccountService(
  token: string,
  accountId: string,
  payload: { service_type: AccountServiceType; status?: "active" | "inactive" | "seasonal" | "unknown"; notes?: string | null }
) {
  return apiFetch<ClientAccountDetail>(`/api/client-command-center/accounts/${accountId}/services`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createClientAccountNote(token: string, accountId: string, payload: { summary: string; contact_id?: string | null }) {
  return apiFetch<ClientAccountDetail>(`/api/client-command-center/accounts/${accountId}/notes`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function createClientAccountTask(
  token: string,
  accountId: string,
  payload: {
    title: string;
    description?: string | null;
    due_at?: string | null;
    priority?: "low" | "normal" | "high" | "urgent";
    service_type?: AccountServiceType | null;
    communication_type?: string | null;
    contact_id?: string | null;
  }
) {
  return apiFetch<ClientAccountDetail>(`/api/client-command-center/accounts/${accountId}/tasks`, token, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}
