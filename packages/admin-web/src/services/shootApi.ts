import { apiFetch } from "../api";
import type {
  ShootDetail,
  ShootPostProductionSubstage,
  ShootReferenceDataResponse,
  ShootStatusEventRecord,
  ShootStatus,
  ShootSummary,
  ShootTypeCode
} from "../types";

export type ShootSaveInput = {
  studio_id: string;
  organization_id: string;
  location_id: string;
  primary_contact_id: string;
  additional_contact_ids?: string[];
  shoot_type: ShootTypeCode;
  shoot_subtype?: string | null;
  shoot_code: string;
  title: string;
  shoot_date: string;
  geofence_radius_meters: number;
  showtime?: string | null;
  arrival_time: string;
  start_time: string;
  end_time_est: string;
  projected_students?: number;
  planned_staff_count?: number;
  required_lead_count?: number;
  status?: ShootStatus;
  status_reason?: string | null;
  post_production_substage?: ShootPostProductionSubstage | null;
  operations_priority?: "standard" | "elevated" | "high_priority";
  big_shoot_manual_override?: boolean;
  camera_station_count?: number;
  shoot_structure?: "standard" | "open_house";
  first_year_customer_flag?: boolean;
  flagship_priority_account_flag?: boolean;
  weather_travel_risk_flag?: boolean;
  manual_leadership_boost?: number;
  importance_override_tier?: "standard" | "elevated" | "big_shoot" | "critical_shoot" | null;
  importance_override_reason?: string | null;
  special_instructions?: string | null;
  access_notes?: string | null;
  additional_products?: string | null;
  additional_products_flag?: boolean;
  special_equipment?: string | null;
  special_equipment_flag?: boolean;
  setup_notes?: string | null;
  day_of_notes?: string | null;
  internal_notes?: string | null;
  pre_service_notes_complete?: boolean;
  special_deliverables_ready?: boolean;
  gear_requirements_ready?: boolean;
  roster_data_required?: boolean;
  roster_data_ready?: boolean;
  allow_checklist_override?: boolean | null;
  checklist_override_reason?: string | null;
};

export type ReadyToShootConfirmationInput = {
  exception_reason?: string | null;
  note?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  accuracy_meters?: number | null;
  device_context?: Record<string, unknown> | null;
};

export type ShootStatusEventInput = {
  type: "ARRIVED" | "SETUP_COMPLETE" | "SHOOTING_STARTED" | "WRAPPED" | "CLOCK_IN" | "CLOCK_OUT";
  captured_at: string;
  location_lat?: number | null;
  location_lng?: number | null;
  client_event_id?: string | null;
  metadata?: Record<string, unknown>;
};

export async function getShootDetail(token: string, shootId: string) {
  return apiFetch<ShootDetail>(`/api/shoots/${shootId}`, token);
}

export async function getShootReferenceData(token: string) {
  return apiFetch<ShootReferenceDataResponse>("/api/shoots/reference-data", token);
}

export async function createShootRecord(token: string, input: ShootSaveInput) {
  return apiFetch<ShootSummary>("/api/shoots", token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function updateShootRecord(token: string, shootId: string, input: Partial<ShootSaveInput>) {
  return apiFetch<ShootSummary>(`/api/shoots/${shootId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function queueShootOutlookPush(token: string, shootId: string) {
  return apiFetch<{ queued: boolean }>(`/api/schedule/items/shoot/${shootId}/outlook-push`, token, {
    method: "POST"
  });
}

export async function confirmShootReadyToShoot(token: string, shootId: string, input: ReadyToShootConfirmationInput) {
  return apiFetch<ShootDetail>(`/api/shoots/${shootId}/ready-to-shoot`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function createShootStatusEvent(token: string, shootId: string, input: ShootStatusEventInput) {
  return apiFetch<ShootStatusEventRecord>(`/api/shoots/${shootId}/status-events`, token, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
