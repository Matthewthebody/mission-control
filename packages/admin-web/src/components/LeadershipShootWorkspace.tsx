import { useEffect, useMemo, useState } from "react";
import { OperationalDetailSection } from "./OperationalDetailSection";
import { ShootStaffingCommand } from "./ShootStaffingCommand";
import { ChecklistTransitionBlockModal } from "./checklists/ChecklistTransitionBlockModal";
import { getOrganizationDetail, listOrganizations } from "../services/organizationApi";
import {
  createShootRecord,
  getShootDetail,
  queueShootOutlookPush,
  updateShootRecord,
  type ShootSaveInput
} from "../services/shootApi";
import type { ChecklistTransitionValidation } from "../checklistTypes";
import { validateChecklistTransition } from "../services/checklistApi";
import { hasAuthorityTier, hasPermission } from "../permissions";
import {
  getAvailableShootStatusOptions,
  getShootLifecycleGuidance,
  getShootPostProductionSubstageLabel,
  getShootPostProductionSubstageOptions,
  getShootStatusLabel,
  getShootStatusReasonLabel,
  normalizeShootStatus,
  shouldRequireShootStatusReason
} from "../shootLifecycle";
import type {
  OrganizationContact,
  OrganizationDetail,
  OrganizationLocation,
  OrganizationSummary,
  ScheduleRecordIntegrationState,
  SessionUser,
  ShootDetail,
  ShootImportanceTier,
  ShootPostProductionSubstage,
  ShootStatus,
  ShootSummary,
  ShootTypeCode
} from "../types";

type ScheduleMember = {
  id: string;
  email: string;
  full_name: string;
  department: string;
  roles: string[];
};

type Props = {
  token: string;
  currentUser: SessionUser;
  members: ScheduleMember[];
  selectedShootId: string | null;
  defaultDate: string;
  defaultStudioId: string;
  canCreateShoot: boolean;
  canManage: boolean;
  canPublish: boolean;
  onSelectShoot: (shootId: string | null) => void;
  onSaved: (shoot: ShootSummary) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

type ShootWorkspaceForm = {
  studio_id: string;
  organization_id: string;
  location_id: string;
  primary_contact_id: string;
  additional_contact_ids: string[];
  shoot_type: ShootTypeCode;
  shoot_subtype: string;
  shoot_code: string;
  title: string;
  shoot_date: string;
  showtime: string;
  start_time: string;
  end_time: string;
  projected_students: string;
  planned_staff_count: string;
  required_lead_count: string;
  status: ShootStatus;
  status_reason: string;
  post_production_substage: ShootPostProductionSubstage | "";
  operations_priority: "standard" | "elevated" | "high_priority";
  big_shoot_manual_override: boolean;
  camera_station_count: string;
  shoot_structure: "standard" | "open_house";
  first_year_customer_flag: boolean;
  flagship_priority_account_flag: boolean;
  weather_travel_risk_flag: boolean;
  manual_leadership_boost: string;
  importance_override_tier: ShootImportanceTier | "";
  importance_override_reason: string;
  geofence_radius_meters: string;
  special_instructions: string;
  access_notes: string;
  additional_products: string;
  additional_products_flag: boolean;
  special_equipment: string;
  special_equipment_flag: boolean;
  setup_notes: string;
  day_of_notes: string;
  internal_notes: string;
  pre_service_notes_complete: boolean;
  special_deliverables_ready: boolean;
  gear_requirements_ready: boolean;
  roster_data_required: boolean;
  roster_data_ready: boolean;
};

const SHOOT_TYPE_OPTIONS: Array<{ value: ShootTypeCode; label: string }> = [
  { value: "sports", label: "Sports" },
  { value: "schools_underclass_portraits", label: "Schools - Underclass Portraits" },
  { value: "schools_events", label: "Schools - Events" },
  { value: "events", label: "Events" },
  { value: "studio", label: "Studio" },
  { value: "headshots", label: "Headshots" },
  { value: "commercial", label: "Commercial" },
  { value: "internal", label: "Internal / Matthew-Specific Jobs" }
];

const IMPORTANCE_OVERRIDE_OPTIONS: Array<{ value: ShootWorkspaceForm["importance_override_tier"]; label: string }> = [
  { value: "", label: "System calculated" },
  { value: "elevated", label: "Elevated" },
  { value: "big_shoot", label: "Big Shoot" },
  { value: "critical_shoot", label: "Critical Shoot" }
];

const POST_PRODUCTION_SUBSTAGE_OPTIONS = getShootPostProductionSubstageOptions();

function createEmptyForm(defaultDate: string, defaultStudioId: string): ShootWorkspaceForm {
  return {
    studio_id: defaultStudioId,
    organization_id: "",
    location_id: "",
    primary_contact_id: "",
    additional_contact_ids: [],
    shoot_type: "schools_underclass_portraits",
    shoot_subtype: "",
    shoot_code: "",
    title: "",
    shoot_date: defaultDate,
    showtime: "14:45",
    start_time: "15:00",
    end_time: "17:00",
    projected_students: "48",
    planned_staff_count: "2",
    required_lead_count: "1",
    status: "CONFIRMED",
    status_reason: "",
    post_production_substage: "",
    operations_priority: "standard",
    big_shoot_manual_override: false,
    camera_station_count: "1",
    shoot_structure: "standard",
    first_year_customer_flag: false,
    flagship_priority_account_flag: false,
    weather_travel_risk_flag: false,
    manual_leadership_boost: "0",
    importance_override_tier: "",
    importance_override_reason: "",
    geofence_radius_meters: "1609",
    special_instructions: "",
    access_notes: "",
    additional_products: "",
    additional_products_flag: false,
    special_equipment: "",
    special_equipment_flag: false,
    setup_notes: "",
    day_of_notes: "",
    internal_notes: "",
    pre_service_notes_complete: false,
    special_deliverables_ready: false,
    gear_requirements_ready: false,
    roster_data_required: false,
    roster_data_ready: false
  };
}

function toTimeInput(value?: string | null, fallback = "") {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function mapLegacyCategoryToShootType(detail: ShootDetail): ShootTypeCode {
  if (detail.shoot_type) {
    return detail.shoot_type;
  }
  if (detail.shoot_category === "sports") {
    return "sports";
  }
  if (detail.shoot_category === "schools") {
    return "schools_underclass_portraits";
  }
  if (detail.shoot_category === "studio") {
    return "studio";
  }
  return "events";
}

function toForm(detail: ShootDetail, defaultStudioId: string): ShootWorkspaceForm {
  return {
    studio_id: detail.studio_id ?? defaultStudioId,
    organization_id: detail.organization_id ?? "",
    location_id: detail.location_id ?? "",
    primary_contact_id: detail.primary_contact_id ?? "",
    additional_contact_ids: detail.additional_contact_ids ?? detail.additional_contacts?.map((contact) => contact.id) ?? [],
    shoot_type: mapLegacyCategoryToShootType(detail),
    shoot_subtype: detail.shoot_subtype ?? "",
    shoot_code: detail.shoot_code,
    title: detail.title,
    shoot_date: detail.shoot_date ?? new Date().toISOString().slice(0, 10),
    showtime: toTimeInput(detail.showtime ?? detail.arrival_time, "14:45"),
    start_time: toTimeInput(detail.start_time, "15:00"),
    end_time: toTimeInput(detail.end_time_est, "17:00"),
    projected_students: String(detail.projected_students ?? 0),
    planned_staff_count: String(detail.planned_staff_count ?? detail.scheduled_employee_count ?? 0),
    required_lead_count: String(detail.required_lead_count ?? 1),
    status: detail.normalized_status ?? normalizeShootStatus(detail.status) ?? "CONFIRMED",
    status_reason: detail.status_reason ?? "",
    post_production_substage: detail.post_production_substage ?? "",
    operations_priority: detail.operations_priority ?? "standard",
    big_shoot_manual_override: Boolean(detail.big_shoot_manual_override),
    camera_station_count: String(detail.camera_station_count ?? Math.max(Number(detail.planned_staff_count ?? 1), 1)),
    shoot_structure: detail.shoot_structure ?? "standard",
    first_year_customer_flag: Boolean(detail.first_year_customer_flag),
    flagship_priority_account_flag: Boolean(detail.flagship_priority_account_flag ?? detail.strategic_district_importance),
    weather_travel_risk_flag: Boolean(detail.weather_travel_risk_flag),
    manual_leadership_boost: String(detail.manual_leadership_boost ?? 0),
    importance_override_tier: detail.importance_override_tier ?? "",
    importance_override_reason: detail.importance_override_reason ?? "",
    geofence_radius_meters: String(detail.geofence_radius_meters ?? 1609),
    special_instructions: detail.special_instructions ?? "",
    access_notes: detail.access_notes ?? "",
    additional_products: detail.additional_products ?? "",
    additional_products_flag: Boolean(detail.additional_products_flag ?? detail.additional_products),
    special_equipment: detail.special_equipment ?? "",
    special_equipment_flag: Boolean(detail.special_equipment_flag ?? detail.special_equipment),
    setup_notes: detail.setup_notes ?? "",
    day_of_notes: detail.day_of_notes ?? "",
    internal_notes: detail.internal_notes ?? "",
    pre_service_notes_complete: Boolean(detail.pre_service_notes_complete),
    special_deliverables_ready: Boolean(detail.special_deliverables_ready),
    gear_requirements_ready: Boolean(detail.gear_requirements_ready),
    roster_data_required: Boolean(detail.roster_data_required),
    roster_data_ready: Boolean(detail.roster_data_ready)
  };
}

function buildIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function humanizeLabel(value?: string | null) {
  if (!value) {
    return "Unknown";
  }
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatShootType(value: ShootTypeCode) {
  return SHOOT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? humanizeLabel(value);
}

function mapShootTypeToTone(value: ShootTypeCode) {
  if (value === "sports") {
    return "sports";
  }
  if (value === "schools_underclass_portraits" || value === "schools_events") {
    return "schools";
  }
  if (value === "studio" || value === "headshots") {
    return "studio";
  }
  return "events";
}

function mapProfitabilityTone(flag?: ShootDetail["future_profitability_flag"]) {
  if (flag === "favorable") {
    return "normal";
  }
  if (flag === "watch") {
    return "watch";
  }
  if (flag === "needs_review") {
    return "critical";
  }
  return "neutral";
}

function mapImportanceTone(tier?: ShootDetail["importance_tier"] | ShootDetail["priority_label"]) {
  if (tier === "critical_shoot") {
    return "critical";
  }
  if (tier === "big_shoot") {
    return "watch";
  }
  if (tier === "elevated") {
    return "normal";
  }
  return "normal";
}

function mapIntegrationTone(health?: ScheduleRecordIntegrationState["sync_health"]) {
  if (health === "healthy") {
    return "normal";
  }
  if (health === "pending" || health === "warning") {
    return "watch";
  }
  if (health === "error") {
    return "critical";
  }
  return "neutral";
}

function buildDraftSlots(plannedStaffCount: number, requiredLeadCount: number) {
  const safeStaffCount = Math.max(plannedStaffCount, 0);
  const safeLeadCount = Math.max(Math.min(requiredLeadCount, safeStaffCount || requiredLeadCount), 0);
  return Array.from({ length: Math.max(safeStaffCount, safeLeadCount) }, (_, index) => {
    const leadSlot = index < safeLeadCount;
    return {
      key: `${leadSlot ? "lead" : "photo"}-${index}`,
      label: leadSlot ? `Lead Coverage ${index + 1}` : `Photographer ${index + 1 - safeLeadCount}`,
      tone: leadSlot ? "critical" : "neutral"
    };
  });
}

function buildOrganizationSummary(organization: OrganizationSummary) {
  return `${formatShootType(organization.account_type)} | ${organization.location_count} locations | ${organization.contact_count} contacts`;
}

function buildLocationSummary(location: OrganizationLocation) {
  return [location.address_display, location.notes].filter(Boolean).join(" | ");
}

function buildContactSummary(contact: OrganizationContact) {
  return [contact.title, contact.phone, contact.email].filter(Boolean).join(" | ");
}

function getChecklistDepartmentForShootType(shootType: ShootTypeCode) {
  if (shootType === "sports") {
    return "sports" as const;
  }
  if (shootType === "headshots") {
    return "headshots" as const;
  }
  if (shootType.startsWith("schools")) {
    return "schools" as const;
  }
  return null;
}

export function LeadershipShootWorkspace({
  token,
  currentUser,
  members,
  selectedShootId,
  defaultDate,
  defaultStudioId,
  canCreateShoot,
  canManage,
  canPublish,
  onSelectShoot,
  onSaved,
  onNotice,
  onError
}: Props) {
  const [form, setForm] = useState<ShootWorkspaceForm>(() => createEmptyForm(defaultDate, defaultStudioId));
  const [organizationQuery, setOrganizationQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  const [organizationResults, setOrganizationResults] = useState<OrganizationSummary[]>([]);
  const [selectedOrganizationDetail, setSelectedOrganizationDetail] = useState<OrganizationDetail | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ShootDetail | null>(null);
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [loadingOrganizationDetail, setLoadingOrganizationDetail] = useState(false);
  const [loadingShoot, setLoadingShoot] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncingOutlook, setSyncingOutlook] = useState(false);
  const [checklistValidation, setChecklistValidation] = useState<ChecklistTransitionValidation | null>(null);
  const [checklistOverrideReason, setChecklistOverrideReason] = useState("");
  const [pendingChecklistPayload, setPendingChecklistPayload] = useState<ShootSaveInput | null>(null);

  const workspaceTone = mapShootTypeToTone(form.shoot_type);
  const integrationState: ScheduleRecordIntegrationState | null = selectedDetail?.integration ?? null;
  const eligiblePhotographers = useMemo(
    () =>
      members.filter((member) =>
        member.roles.some((role) =>
          ["associate_photographer", "photographer", "senior_photographer", "director_of_photography", "lead_photographer"].includes(role)
        )
      ),
    [members]
  );
  const draftSlots = useMemo(
    () => buildDraftSlots(Number(form.planned_staff_count || 0), Number(form.required_lead_count || 0)),
    [form.planned_staff_count, form.required_lead_count]
  );
  const selectedOrganization = selectedOrganizationDetail?.organization ?? null;
  const selectedLocation =
    selectedOrganizationDetail?.locations.find((location) => location.id === form.location_id) ?? null;
  const selectedPrimaryContact =
    selectedOrganizationDetail?.contacts.find((contact) => contact.id === form.primary_contact_id) ?? null;
  const selectedAdditionalContacts = useMemo(
    () =>
      (selectedOrganizationDetail?.contacts ?? []).filter(
        (contact) => contact.id !== form.primary_contact_id && form.additional_contact_ids.includes(contact.id)
      ),
    [form.additional_contact_ids, form.primary_contact_id, selectedOrganizationDetail?.contacts]
  );
  const filteredLocations = useMemo(() => {
    const query = locationQuery.trim().toLowerCase();
    const locations = selectedOrganizationDetail?.locations ?? [];
    if (!query) {
      return locations;
    }
    return locations.filter((location) =>
      [location.location_name, location.address_display, location.notes].filter(Boolean).join(" ").toLowerCase().includes(query)
    );
  }, [locationQuery, selectedOrganizationDetail?.locations]);
  const currentNormalizedStatus = selectedDetail?.normalized_status ?? null;
  const priorActiveStatus = selectedDetail?.on_hold_return_status ?? null;
  const readyEligible = selectedDetail?.ready_eligible ?? false;
  const statusOptions = useMemo(
    () =>
      getAvailableShootStatusOptions({
        currentStatus: currentNormalizedStatus,
        priorActiveStatus,
        readyEligible,
        allowCompleteReopen: canManage
      }),
    [canManage, currentNormalizedStatus, priorActiveStatus, readyEligible]
  );
  const statusReasonRequired = shouldRequireShootStatusReason({
    currentStatus: currentNormalizedStatus,
    nextStatus: form.status
  });
  const lifecycleGuidance = getShootLifecycleGuidance({
    currentStatus: currentNormalizedStatus,
    nextStatus: form.status,
    readyEligible,
    postProductionSubstage: form.post_production_substage
  });
  const showStatusReasonField = Boolean(form.status_reason.trim() || statusReasonRequired || selectedDetail?.status_reason);
  const showPostProductionSubstage = form.status === "POST_PRODUCTION";
  const readinessRequirements = selectedDetail?.readiness_requirements ?? [];
  const operationalFlags = selectedDetail?.operational_flags ?? [];
  const canOverrideChecklistBlock = hasPermission(currentUser, "checklist.override.soft_block") || hasAuthorityTier(currentUser, ["leadership", "super_admin"]);

  useEffect(() => {
    if (organizationQuery.trim().length < 2) {
      setOrganizationResults([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      setLoadingOrganizations(true);
      void listOrganizations(token, { search: organizationQuery.trim() })
        .then((payload) => {
          if (!cancelled) {
            setOrganizationResults(payload.organizations);
          }
        })
        .catch((error) => {
          if (!cancelled) {
            onError(error instanceof Error ? error.message : "We couldn't search Organizations.");
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoadingOrganizations(false);
          }
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [onError, organizationQuery, token]);

  useEffect(() => {
    if (!form.organization_id) {
      setSelectedOrganizationDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingOrganizationDetail(true);
    void getOrganizationDetail(token, form.organization_id)
      .then((detail) => {
        if (!cancelled) {
          setSelectedOrganizationDetail(detail);
          setOrganizationQuery(detail.organization.display_name);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "We couldn't load the selected Organization.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingOrganizationDetail(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [form.organization_id, onError, token]);

  useEffect(() => {
    if (!selectedShootId) {
      setSelectedDetail(null);
      setSelectedOrganizationDetail(null);
      setOrganizationQuery("");
      setLocationQuery("");
      setForm(createEmptyForm(defaultDate, defaultStudioId));
      return;
    }
    let cancelled = false;
    setLoadingShoot(true);
    void getShootDetail(token, selectedShootId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedDetail(detail);
          setForm(toForm(detail, defaultStudioId));
          setLocationQuery(detail.location_name ?? "");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          onError(error instanceof Error ? error.message : "We couldn't load that Shoot workspace.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingShoot(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [defaultDate, defaultStudioId, onError, selectedShootId, token]);

  function applyOrganization(organization: OrganizationSummary) {
    setForm((current) => ({
      ...current,
      organization_id: organization.id,
      location_id: "",
      primary_contact_id: "",
      additional_contact_ids: [],
      shoot_type: current.shoot_type || organization.account_type
    }));
    setOrganizationQuery(organization.display_name);
    setLocationQuery("");
  }

  function applyLocation(location: OrganizationLocation) {
    setForm((current) => ({
      ...current,
      location_id: location.id
    }));
    setLocationQuery(location.location_name);
  }

  function applyPrimaryContact(contactId: string) {
    setForm((current) => ({
      ...current,
      primary_contact_id: contactId,
      additional_contact_ids: current.additional_contact_ids.filter((id) => id !== contactId)
    }));
  }

  function toggleAdditionalContact(contactId: string) {
    setForm((current) => ({
      ...current,
      additional_contact_ids: current.additional_contact_ids.includes(contactId)
        ? current.additional_contact_ids.filter((id) => id !== contactId)
        : [...current.additional_contact_ids, contactId]
    }));
  }

  function resetWorkspace() {
    setSelectedDetail(null);
    setSelectedOrganizationDetail(null);
    setOrganizationQuery("");
    setLocationQuery("");
    onSelectShoot(null);
    setForm(createEmptyForm(defaultDate, defaultStudioId));
  }

  function buildSavePayload(extra: Partial<ShootSaveInput> = {}): ShootSaveInput {
    return {
      studio_id: form.studio_id || defaultStudioId,
      organization_id: form.organization_id,
      location_id: form.location_id,
      primary_contact_id: form.primary_contact_id,
      additional_contact_ids: form.additional_contact_ids,
      shoot_type: form.shoot_type,
      shoot_subtype: form.shoot_subtype.trim() || null,
      shoot_code: form.shoot_code.trim(),
      title: form.title.trim(),
      shoot_date: form.shoot_date,
      geofence_radius_meters: Number(form.geofence_radius_meters || 1609),
      showtime: buildIso(form.shoot_date, form.showtime),
      arrival_time: buildIso(form.shoot_date, form.showtime),
      start_time: buildIso(form.shoot_date, form.start_time),
      end_time_est: buildIso(form.shoot_date, form.end_time),
      projected_students: Number(form.projected_students || 0),
      planned_staff_count: Number(form.planned_staff_count || 0),
      required_lead_count: Math.max(1, Number(form.required_lead_count || 1)),
      status: form.status,
      status_reason: form.status_reason.trim() || null,
      post_production_substage: form.status === "POST_PRODUCTION" ? form.post_production_substage || null : null,
      operations_priority: form.operations_priority,
      big_shoot_manual_override: Boolean(form.importance_override_tier),
      camera_station_count: Math.max(1, Number(form.camera_station_count || 1)),
      shoot_structure: form.shoot_structure,
      first_year_customer_flag: form.first_year_customer_flag,
      flagship_priority_account_flag: form.flagship_priority_account_flag,
      weather_travel_risk_flag: form.weather_travel_risk_flag,
      manual_leadership_boost: Math.max(0, Math.min(15, Number(form.manual_leadership_boost || 0))),
      importance_override_tier: form.importance_override_tier || null,
      importance_override_reason: form.importance_override_tier ? form.importance_override_reason.trim() : null,
      special_instructions: form.special_instructions.trim() || null,
      access_notes: form.access_notes.trim() || null,
      additional_products: form.additional_products.trim() || null,
      additional_products_flag: form.additional_products_flag || Boolean(form.additional_products.trim()),
      special_equipment: form.special_equipment.trim() || null,
      special_equipment_flag: form.special_equipment_flag || Boolean(form.special_equipment.trim()),
      setup_notes: form.setup_notes.trim() || null,
      day_of_notes: form.day_of_notes.trim() || null,
      internal_notes: form.internal_notes.trim() || null,
      pre_service_notes_complete: form.pre_service_notes_complete,
      special_deliverables_ready: form.special_deliverables_ready,
      gear_requirements_ready: form.gear_requirements_ready,
      roster_data_required: form.roster_data_required,
      roster_data_ready: form.roster_data_required ? form.roster_data_ready : false,
      ...extra
    };
  }

  async function executeSave(payload: ShootSaveInput) {
    setSaving(true);
    try {
      const saved = selectedShootId
        ? await updateShootRecord(token, selectedShootId, payload)
        : await createShootRecord(token, payload);
      onSaved(saved);
      onSelectShoot(saved.id);
      onNotice(selectedShootId ? `${saved.shoot_code} was updated.` : `${saved.shoot_code} was created and is ready for staffing.`);
      const refreshed = await getShootDetail(token, saved.id);
      setSelectedDetail(refreshed);
      setForm(toForm(refreshed, defaultStudioId));
      setLocationQuery(refreshed.location_name ?? "");
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't save that Shoot.");
    } finally {
      setSaving(false);
    }
  }

  async function saveWorkspace() {
    if (!canCreateShoot && !selectedShootId) {
      onError("You do not have permission to create Shoots.");
      return;
    }
    if (!form.organization_id || !form.location_id || !form.primary_contact_id) {
      onError("Organization, Location, and primary Contact are required before saving.");
      return;
    }
    if (!form.shoot_code || !form.title) {
      onError("Shoot code and title are required before saving.");
      return;
    }
    if (form.importance_override_tier && !form.importance_override_reason.trim()) {
      onError("A manual importance override requires a reason.");
      return;
    }
    if (showPostProductionSubstage && !form.post_production_substage) {
      onError("Choose the active post-production stage before saving.");
      return;
    }
    if (statusReasonRequired && !form.status_reason.trim()) {
      onError(`${getShootStatusReasonLabel({ currentStatus: currentNormalizedStatus, nextStatus: form.status })} is required for that transition.`);
      return;
    }

    const payload = buildSavePayload();
    if (selectedShootId && currentNormalizedStatus && currentNormalizedStatus !== form.status) {
      try {
        const response = await validateChecklistTransition(token, {
          resource_type: "shoot",
          from_stage: currentNormalizedStatus,
          to_stage: form.status,
          department_type: getChecklistDepartmentForShootType(form.shoot_type),
          shoot_id: selectedShootId
        });
        const validation = response.validation;
        if (!validation.allowed) {
          setChecklistValidation(validation);
          setPendingChecklistPayload(payload);
          setChecklistOverrideReason("");
          return;
        }
      } catch (error) {
        onError(error instanceof Error ? error.message : "We couldn't validate checklist blocks for that Shoot transition.");
        return;
      }
    }

    await executeSave(payload);
  }

  async function handleChecklistOverrideSave() {
    if (!pendingChecklistPayload || !checklistOverrideReason.trim()) {
      return;
    }
    await executeSave({
      ...pendingChecklistPayload,
      allow_checklist_override: true,
      checklist_override_reason: checklistOverrideReason.trim()
    });
    setChecklistValidation(null);
    setPendingChecklistPayload(null);
    setChecklistOverrideReason("");
  }

  async function pushToOutlook() {
    if (!selectedShootId) {
      return;
    }
    setSyncingOutlook(true);
    try {
      await queueShootOutlookPush(token, selectedShootId);
      onNotice("Queued an explicit Outlook push for this Shoot.");
    } catch (error) {
      onError(error instanceof Error ? error.message : "We couldn't queue the Outlook push.");
    } finally {
      setSyncingOutlook(false);
    }
  }

  return (
    <>
      <section className={`leadership-shoot-workspace leadership-shoot-workspace--${workspaceTone}`}>
      <div className="leadership-shoot-workspace__header">
        <div>
          <div className="eyebrow">Leadership Shoot Workspace</div>
          <h3>{selectedShootId ? `${form.shoot_code || "Shoot"} | ${form.title || "Edit Shoot"}` : "New Shoot"}</h3>
          <p className="section-subtitle">
            Anchor every Shoot to one Organization, one Location, and one day-of Contact so scheduling, staffing, maps, and follow-through stay structured.
          </p>
        </div>
        <div className="leadership-shoot-workspace__actions">
          <span className={`shoot-type-chip shoot-type-chip--${workspaceTone}`}>{formatShootType(form.shoot_type)}</span>
          <span className="meta-pill">{selectedDetail?.status_display ?? getShootStatusLabel(form.status)}</span>
          {selectedDetail?.importance_tier_display ? (
            <span className={`risk-pill risk-pill--${mapImportanceTone(selectedDetail.importance_tier ?? selectedDetail.priority_label)}`}>
              {selectedDetail.importance_tier_display}
            </span>
          ) : selectedDetail?.priority_label_display ? (
            <span className={`risk-pill risk-pill--${mapImportanceTone(selectedDetail.priority_label)}`}>
              {selectedDetail.priority_label_display}
            </span>
          ) : null}
          {selectedDetail?.importance_score != null ? <span className="meta-pill">Importance {selectedDetail.importance_score}/100</span> : null}
          {selectedDetail?.importance_override_applied && selectedDetail.importance_override_reason ? (
            <span className="meta-pill" title={selectedDetail.importance_override_reason}>
              Override active
            </span>
          ) : null}
          {selectedDetail?.future_profitability_display ? (
            <span className={`risk-pill risk-pill--${mapProfitabilityTone(selectedDetail.future_profitability_flag)}`}>
              Profitability {selectedDetail.future_profitability_display}
            </span>
          ) : (
            <span className="meta-pill">Profitability placeholder</span>
          )}
          {integrationState ? (
            <span className={`risk-pill risk-pill--${mapIntegrationTone(integrationState.sync_health)}`}>
              Outlook {humanizeLabel(integrationState.sync_state)}
            </span>
          ) : (
            <span className="meta-pill">Outlook not linked</span>
          )}
        </div>
      </div>

      <div className="leadership-shoot-workspace__summary">
        <div className="dashboard-summary-row">
          <span className="muted">Organization</span>
          <strong>{selectedOrganization?.display_name ?? "Select Organization"}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Location</span>
          <strong>{selectedLocation?.location_name ?? "Select Location"}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Primary Contact</span>
          <strong>{selectedPrimaryContact?.full_name ?? "Select Contact"}</strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Staffing Plan</span>
          <strong>
            {form.planned_staff_count || "0"} slots | {form.required_lead_count || "0"} lead
          </strong>
        </div>
        <div className="dashboard-summary-row">
          <span className="muted">Lifecycle</span>
          <strong>{selectedDetail?.status_display ?? getShootStatusLabel(form.status)}</strong>
        </div>
      </div>

      {loadingShoot ? <div className="empty-state empty-state--panel">Loading Shoot workspace.</div> : null}
      {loadingOrganizationDetail ? <div className="empty-state empty-state--panel">Loading Organization, Location, and Contact records.</div> : null}

      <OperationalDetailSection
        title="Shoot Summary"
        summary="Classify the job, set the operating window, and keep the Shoot tied to the right Organization."
        defaultOpen
      >
        <div className="field-grid leadership-shoot-workspace__grid">
          <label className="filter-field">
            <span>Shoot Type</span>
            <select
              value={form.shoot_type}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  shoot_type: event.target.value as ShootTypeCode
                }))
              }
            >
              {SHOOT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field">
            <span>Shoot Subtype</span>
            <input value={form.shoot_subtype} onChange={(event) => setForm((current) => ({ ...current, shoot_subtype: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Shoot Code</span>
            <input value={form.shoot_code} onChange={(event) => setForm((current) => ({ ...current, shoot_code: event.target.value }))} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Shoot Title / Job Name</span>
            <input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Date</span>
            <input type="date" value={form.shoot_date} onChange={(event) => setForm((current) => ({ ...current, shoot_date: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Showtime</span>
            <input type="time" value={form.showtime} onChange={(event) => setForm((current) => ({ ...current, showtime: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Shoot Start</span>
            <input type="time" value={form.start_time} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value }))} />
          </label>
          <label className="filter-field">
            <span>Expected End</span>
            <input type="time" value={form.end_time} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} />
          </label>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Shoot Lifecycle"
        summary="Use one primary lifecycle status, readiness checks, and flags instead of inventing new status labels for every issue."
        defaultOpen
      >
        <div className="leadership-shoot-workspace__location-card">
          <div className="leadership-shoot-workspace__location-head">
            <div>
              <div className="eyebrow">Current lifecycle</div>
              <strong>{selectedDetail?.status_display ?? getShootStatusLabel(form.status)}</strong>
            </div>
            {selectedDetail?.post_production_substage_display ? (
              <span className="meta-pill">{selectedDetail.post_production_substage_display}</span>
            ) : null}
          </div>
          <div className="muted">{lifecycleGuidance}</div>
        </div>

        <div className="field-grid leadership-shoot-workspace__grid">
          <label className="filter-field">
            <span>Primary Status</span>
            <select
              value={form.status}
              onChange={(event) =>
                setForm((current) => {
                  const nextStatus = event.target.value as ShootWorkspaceForm["status"];
                  return {
                    ...current,
                    status: nextStatus,
                    post_production_substage:
                      nextStatus === "POST_PRODUCTION"
                        ? current.post_production_substage || "INTAKE_PENDING"
                        : "",
                    status_reason:
                      shouldRequireShootStatusReason({ currentStatus: currentNormalizedStatus, nextStatus }) || current.status_reason.trim()
                        ? current.status_reason
                        : ""
                  };
                })
              }
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value} disabled={option.disabled}>
                  {option.label}
                  {option.note ? ` | ${option.note}` : ""}
                </option>
              ))}
            </select>
          </label>
          {showPostProductionSubstage ? (
            <label className="filter-field">
              <span>Post-Production Stage</span>
              <select
                value={form.post_production_substage}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    post_production_substage: event.target.value as ShootWorkspaceForm["post_production_substage"]
                  }))
                }
              >
                <option value="">Choose stage</option>
                {POST_PRODUCTION_SUBSTAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showStatusReasonField ? (
            <label className="filter-field filter-field--wide">
              <span>{getShootStatusReasonLabel({ currentStatus: currentNormalizedStatus, nextStatus: form.status })}</span>
              <textarea
                rows={2}
                placeholder="Required for hold, cancellation, or reopening a completed shoot."
                value={form.status_reason}
                onChange={(event) => setForm((current) => ({ ...current, status_reason: event.target.value }))}
              />
            </label>
          ) : null}
        </div>

        <div className="detail-two-column">
          <div className="request-card">
            <strong>{selectedDetail?.readiness_summary ?? (readyEligible ? "Ready Eligible" : "Readiness still needs work")}</strong>
            <div className="muted">
              {readyEligible
                ? "Critical pre-shoot requirements are met, but a trusted user still confirms the move to Ready."
                : "Ready stays manual. The system only checks whether the shoot is eligible for that move."}
            </div>
            <div className="leadership-shoot-workspace__flag-strip">
              <span className={`ops-preview-flag ops-preview-flag--${readyEligible ? "neutral" : "warning"}`}>
                {readyEligible ? "Ready Eligible" : "Not Ready Yet"}
              </span>
              {selectedDetail?.status_display ? <span className="ops-preview-flag ops-preview-flag--neutral">{selectedDetail.status_display}</span> : null}
              {selectedDetail?.post_production_substage ? (
                <span className="ops-preview-flag ops-preview-flag--neutral">
                  {getShootPostProductionSubstageLabel(selectedDetail.post_production_substage)}
                </span>
              ) : null}
            </div>
          </div>
          <div className="request-card">
            <strong>Operational Flags</strong>
            <div className="muted">
              Flags carry issues like staffing gaps, data gaps, and blocked work without muddying the primary status.
            </div>
            <div className="leadership-shoot-workspace__flag-strip">
              {operationalFlags.length ? (
                operationalFlags.map((flag) => (
                  <span key={flag.code} className={`ops-preview-flag ops-preview-flag--${flag.tone === "critical" ? "critical" : flag.tone === "warning" ? "warning" : "neutral"}`}>
                    {flag.label}
                  </span>
                ))
              ) : (
                <span className="ops-preview-flag ops-preview-flag--neutral">No operational flags on this shoot right now</span>
              )}
            </div>
          </div>
        </div>

        <div className="dashboard-stack">
          <div className="dashboard-panel__header">
            <div>
              <div className="section-title">Readiness Checks</div>
              <p className="section-subtitle">Leadership can see the exact checklist behind Ready Eligible and still keep the final green light manual.</p>
            </div>
          </div>
          <div className="field-grid leadership-shoot-workspace__grid">
            <label className="filter-field leadership-shoot-workspace__checkbox">
              <span>Pre-Service Notes</span>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={form.pre_service_notes_complete}
                  onChange={(event) => setForm((current) => ({ ...current, pre_service_notes_complete: event.target.checked }))}
                />
                <span>Required pre-service notes are complete</span>
              </label>
            </label>
            <label className="filter-field leadership-shoot-workspace__checkbox">
              <span>Special Deliverables</span>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={form.special_deliverables_ready}
                  onChange={(event) => setForm((current) => ({ ...current, special_deliverables_ready: event.target.checked }))}
                />
                <span>Special deliverables are documented</span>
              </label>
            </label>
            <label className="filter-field leadership-shoot-workspace__checkbox">
              <span>Gear Requirements</span>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={form.gear_requirements_ready}
                  onChange={(event) => setForm((current) => ({ ...current, gear_requirements_ready: event.target.checked }))}
                />
                <span>Gear requirements are assigned</span>
              </label>
            </label>
            <label className="filter-field leadership-shoot-workspace__checkbox">
              <span>Roster / Data Needed</span>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={form.roster_data_required}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      roster_data_required: event.target.checked,
                      roster_data_ready: event.target.checked ? current.roster_data_ready : false
                    }))
                  }
                />
                <span>This shoot requires roster or data readiness</span>
              </label>
            </label>
            {form.roster_data_required ? (
              <label className="filter-field leadership-shoot-workspace__checkbox">
                <span>Roster / Data Ready</span>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={form.roster_data_ready}
                    onChange={(event) => setForm((current) => ({ ...current, roster_data_ready: event.target.checked }))}
                  />
                  <span>Roster or data is marked ready</span>
                </label>
              </label>
            ) : null}
          </div>

          {readinessRequirements.length ? (
            <div className="leadership-shoot-workspace__picker-list">
              {readinessRequirements.map((requirement) => (
                <div key={requirement.key} className="leadership-shoot-workspace__picker-item is-static">
                  <strong>{requirement.label}</strong>
                  <span>{requirement.detail ?? (requirement.complete ? "Complete" : "Still needs attention")}</span>
                  <span className={`meta-pill${requirement.complete ? "" : " meta-pill--warning"}`}>
                    {requirement.complete ? "Complete" : "Open"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state--panel">Readiness requirements will appear here once the shoot has been saved.</div>
          )}
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Organization, Location, and Contacts"
        summary="Search first, then select the canonical records that should anchor this Shoot."
        defaultOpen
      >
        <div className="field-grid leadership-shoot-workspace__grid">
          <label className="filter-field filter-field--wide">
            <span>Search Organizations</span>
            <input
              value={organizationQuery}
              onChange={(event) => setOrganizationQuery(event.target.value)}
              placeholder="Search school, team, studio, event client..."
            />
          </label>
        </div>

        {loadingOrganizations ? <div className="empty-state empty-state--panel">Searching Organizations.</div> : null}
        {organizationResults.length ? (
          <div className="leadership-shoot-workspace__picker-list">
            {organizationResults.map((organization) => (
              <button
                key={organization.id}
                className={`leadership-shoot-workspace__picker-item${form.organization_id === organization.id ? " is-selected" : ""}`}
                onClick={() => applyOrganization(organization)}
              >
                <strong>{organization.display_name}</strong>
                <span>{buildOrganizationSummary(organization)}</span>
                {organization.aliases.length ? <span className="muted">Aliases: {organization.aliases.slice(0, 2).join(", ")}</span> : null}
              </button>
            ))}
          </div>
        ) : null}

        {!selectedOrganization && !organizationResults.length ? (
          <div className="empty-state empty-state--panel">
            Search for an existing Organization first. This flow is intentionally biased toward canonical selection before new data gets typed anywhere else in the product.
          </div>
        ) : null}

        {selectedOrganization ? (
          <article className="leadership-shoot-workspace__location-card">
            <div className="leadership-shoot-workspace__location-head">
              <div>
                <div className="eyebrow">Selected Organization</div>
                <strong>{selectedOrganization.display_name}</strong>
              </div>
              <span className={`shoot-type-chip shoot-type-chip--${mapShootTypeToTone(selectedOrganization.account_type)}`}>
                {formatShootType(selectedOrganization.account_type)}
              </span>
            </div>
            <div className="muted">{buildOrganizationSummary(selectedOrganization)}</div>
            {selectedOrganization.notes ? <div className="muted">{selectedOrganization.notes}</div> : null}
          </article>
        ) : null}

        {selectedOrganizationDetail ? (
          <>
            <div className="field-grid leadership-shoot-workspace__grid">
              <label className="filter-field filter-field--wide">
                <span>Search Organization Locations</span>
                <input
                  value={locationQuery}
                  onChange={(event) => setLocationQuery(event.target.value)}
                  placeholder="Gym, stadium, office, studio..."
                />
              </label>
              <label className="filter-field">
                <span>Primary Contact</span>
                <select value={form.primary_contact_id} onChange={(event) => applyPrimaryContact(event.target.value)}>
                  <option value="">Choose a primary Contact</option>
                  {selectedOrganizationDetail.contacts.map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.full_name}
                      {contact.title ? ` | ${contact.title}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="leadership-shoot-workspace__picker-list">
              {filteredLocations.map((location) => (
                <button
                  key={location.id}
                  className={`leadership-shoot-workspace__picker-item${form.location_id === location.id ? " is-selected" : ""}`}
                  onClick={() => applyLocation(location)}
                >
                  <strong>{location.location_name}</strong>
                  <span>{buildLocationSummary(location) || "Location profile linked."}</span>
                </button>
              ))}
              {!filteredLocations.length ? <div className="empty-state">No saved Locations match that search.</div> : null}
            </div>

            {selectedLocation ? (
              <article className="leadership-shoot-workspace__location-card">
                <div className="leadership-shoot-workspace__location-head">
                  <div>
                    <div className="eyebrow">Selected Location</div>
                    <strong>{selectedLocation.location_name}</strong>
                  </div>
                  {selectedLocation.maps_url ? (
                    <a className="secondary-button" href={selectedLocation.maps_url} target="_blank" rel="noreferrer">
                      Open In Maps
                    </a>
                  ) : null}
                </div>
                <div className="muted">{selectedLocation.address_display ?? "Address pending"}</div>
                {selectedLocation.notes ? <div className="muted">{selectedLocation.notes}</div> : null}
              </article>
            ) : null}

            {selectedPrimaryContact ? (
              <article className="leadership-shoot-workspace__location-card">
                <div className="leadership-shoot-workspace__location-head">
                  <div>
                    <div className="eyebrow">Primary Contact</div>
                    <strong>{selectedPrimaryContact.full_name}</strong>
                  </div>
                </div>
                <div className="muted">{buildContactSummary(selectedPrimaryContact) || "Day-of contact linked."}</div>
                {selectedPrimaryContact.notes ? <div className="muted">{selectedPrimaryContact.notes}</div> : null}
              </article>
            ) : null}

            <div className="dashboard-panel__header">
              <div>
                <div className="section-title">Additional Contacts</div>
                <p className="section-subtitle">Optional secondary Contacts for backup coordination, office escalation, or venue access.</p>
              </div>
            </div>
            <div className="leadership-shoot-workspace__picker-list">
              {selectedOrganizationDetail.contacts
                .filter((contact) => contact.id !== form.primary_contact_id)
                .map((contact) => {
                  const selected = form.additional_contact_ids.includes(contact.id);
                  return (
                    <button
                      key={contact.id}
                      className={`leadership-shoot-workspace__picker-item${selected ? " is-selected" : ""}`}
                      onClick={() => toggleAdditionalContact(contact.id)}
                    >
                      <strong>{contact.full_name}</strong>
                      <span>{buildContactSummary(contact) || "Contact record linked."}</span>
                      {selected ? <span className="meta-pill">Added to Shoot</span> : null}
                    </button>
                  );
                })}
              {!selectedOrganizationDetail.contacts.filter((contact) => contact.id !== form.primary_contact_id).length ? (
                <div className="empty-state">No additional Contacts are available on this Organization yet.</div>
              ) : null}
            </div>
          </>
        ) : null}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Staffing Plan"
        summary="Headcount creates the slot structure immediately. Saved Shoots switch into live assignment with conflict and override controls."
        defaultOpen
      >
        <div className="field-grid leadership-shoot-workspace__grid">
          <label className="filter-field">
            <span>Photographers Needed</span>
            <input
              value={form.planned_staff_count}
              onChange={(event) => setForm((current) => ({ ...current, planned_staff_count: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Lead / Senior / Director Coverage</span>
            <input
              value={form.required_lead_count}
              onChange={(event) => setForm((current) => ({ ...current, required_lead_count: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Projected Volume</span>
            <input
              value={form.projected_students}
              onChange={(event) => setForm((current) => ({ ...current, projected_students: event.target.value }))}
            />
          </label>
        </div>

        <div className="leadership-shoot-workspace__slot-preview">
          {draftSlots.map((slot) => (
            <article key={slot.key} className="leadership-shoot-workspace__slot-card">
              <div className="leadership-shoot-workspace__slot-head">
                <strong>{slot.label}</strong>
                <span className={`ops-preview-chip ops-preview-chip--${slot.tone}`}>{slot.tone === "critical" ? "Lead coverage" : "Photographer"}</span>
              </div>
              <div className="muted">
                {slot.tone === "critical"
                  ? "Fill with a lead-qualified senior photographer or director."
                  : `Choose from ${eligiblePhotographers.length} photographer-designated staff after save.`}
              </div>
            </article>
          ))}
          {!draftSlots.length ? <div className="empty-state">Add planned headcount to generate staffing slots.</div> : null}
        </div>

        {selectedShootId ? (
          <ShootStaffingCommand
            token={token}
            shootId={selectedShootId}
            canPublish={canPublish}
            onNotice={onNotice}
            onError={onError}
            onUpdated={() => {
              onNotice("Staffing assignments updated.");
              onSaved({
                id: selectedShootId,
                shoot_code: form.shoot_code,
                title: form.title,
                shoot_date: form.shoot_date,
                location_name: selectedLocation?.location_name ?? selectedDetail?.location_name ?? "Location pending"
              } as ShootSummary);
            }}
            className="leadership-shoot-workspace__staffing"
            emptyStateLabel="Staffing Control"
            emptyStateSummary="Save the Shoot first, then assign staff into the generated slots."
          />
        ) : (
          <div className="empty-state empty-state--panel">Save the Shoot to unlock the live staffing assignment interface.</div>
        )}
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Operational Notes"
        summary="Keep access, setup, product, and day-of guidance attached to the Shoot instead of retyping it elsewhere."
      >
        <div className="field-grid leadership-shoot-workspace__grid">
          <label className="filter-field filter-field--wide">
            <span>Special Instructions</span>
            <textarea
              rows={3}
              value={form.special_instructions}
              onChange={(event) => setForm((current) => ({ ...current, special_instructions: event.target.value }))}
            />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Access / Parking Notes</span>
            <textarea rows={3} value={form.access_notes} onChange={(event) => setForm((current) => ({ ...current, access_notes: event.target.value }))} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Additional Products Needed</span>
            <textarea
              rows={2}
              value={form.additional_products}
              onChange={(event) => setForm((current) => ({ ...current, additional_products: event.target.value }))}
            />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Special Equipment Required</span>
            <textarea
              rows={2}
              value={form.special_equipment}
              onChange={(event) => setForm((current) => ({ ...current, special_equipment: event.target.value }))}
            />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Setup Notes</span>
            <textarea rows={3} value={form.setup_notes} onChange={(event) => setForm((current) => ({ ...current, setup_notes: event.target.value }))} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Day-Of Notes</span>
            <textarea rows={3} value={form.day_of_notes} onChange={(event) => setForm((current) => ({ ...current, day_of_notes: event.target.value }))} />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Internal Notes</span>
            <textarea rows={3} value={form.internal_notes} onChange={(event) => setForm((current) => ({ ...current, internal_notes: event.target.value }))} />
          </label>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Operational Flags and Sync"
        summary="Importance stays rule-based first. Leadership can tune the scoring inputs, add a small manual boost, or apply an audited override with a reason."
      >
        <div className="field-grid leadership-shoot-workspace__grid">
          <label className="filter-field">
            <span>Camera Stations</span>
            <input
              value={form.camera_station_count}
              onChange={(event) => setForm((current) => ({ ...current, camera_station_count: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Shoot Structure</span>
            <select
              value={form.shoot_structure}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  shoot_structure: event.target.value as ShootWorkspaceForm["shoot_structure"]
                }))
              }
            >
              <option value="standard">Standard</option>
              <option value="open_house">Open House</option>
            </select>
          </label>
          <label className="filter-field">
            <span>Leadership Boost</span>
            <input
              value={form.manual_leadership_boost}
              onChange={(event) => setForm((current) => ({ ...current, manual_leadership_boost: event.target.value }))}
            />
          </label>
          <label className="filter-field">
            <span>Geofence Radius (meters)</span>
            <input
              value={form.geofence_radius_meters}
              onChange={(event) => setForm((current) => ({ ...current, geofence_radius_meters: event.target.value }))}
            />
          </label>
          <label className="filter-field filter-field--wide">
            <span>Manual Override</span>
            <select
              value={form.importance_override_tier}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  importance_override_tier: event.target.value as ShootWorkspaceForm["importance_override_tier"],
                  big_shoot_manual_override: Boolean(event.target.value)
                }))
              }
            >
              {IMPORTANCE_OVERRIDE_OPTIONS.map((option) => (
                <option key={option.label} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="filter-field filter-field--wide">
            <span>Override Reason</span>
            <textarea
              rows={2}
              value={form.importance_override_reason}
              placeholder="Required when leadership overrides the calculated designation."
              onChange={(event) => setForm((current) => ({ ...current, importance_override_reason: event.target.value }))}
            />
          </label>
          <label className="filter-field filter-field--wide leadership-shoot-workspace__checkbox">
            <span>Account Visibility</span>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={form.flagship_priority_account_flag}
                onChange={(event) => setForm((current) => ({ ...current, flagship_priority_account_flag: event.target.checked }))}
              />
              <span>Flagship or priority account</span>
            </label>
          </label>
          <label className="filter-field filter-field--wide leadership-shoot-workspace__checkbox">
            <span>Customer Context</span>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={form.first_year_customer_flag}
                onChange={(event) => setForm((current) => ({ ...current, first_year_customer_flag: event.target.checked }))}
              />
              <span>First-year customer</span>
            </label>
          </label>
          <label className="filter-field filter-field--wide leadership-shoot-workspace__checkbox">
            <span>Weather / Travel Risk</span>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={form.weather_travel_risk_flag}
                onChange={(event) => setForm((current) => ({ ...current, weather_travel_risk_flag: event.target.checked }))}
              />
              <span>Known weather or travel risk is already visible</span>
            </label>
          </label>
        </div>

        <div className="leadership-shoot-workspace__flag-strip">
          {selectedDetail?.importance_tier_display ? (
            <span className="ops-preview-flag ops-preview-flag--critical">
              {selectedDetail.importance_tier_display}
              {selectedDetail.importance_score != null ? ` | ${selectedDetail.importance_score}/100` : ""}
            </span>
          ) : null}
          {selectedDetail?.importance_override_applied && selectedDetail.importance_override_reason ? (
            <span className="ops-preview-flag ops-preview-flag--warning" title={selectedDetail.importance_override_reason}>
              Manual override active
            </span>
          ) : null}
          {form.special_equipment_flag || form.special_equipment ? (
            <span className="ops-preview-flag ops-preview-flag--warning">Special equipment required</span>
          ) : null}
          {form.first_year_customer_flag ? <span className="ops-preview-flag ops-preview-flag--warning">First-year customer</span> : null}
          {form.flagship_priority_account_flag ? <span className="ops-preview-flag ops-preview-flag--critical">Priority account</span> : null}
          {form.weather_travel_risk_flag ? <span className="ops-preview-flag ops-preview-flag--warning">Travel risk</span> : null}
          {form.access_notes ? <span className="ops-preview-flag ops-preview-flag--warning">Access / parking watch</span> : null}
          {form.additional_products_flag || form.additional_products ? (
            <span className="ops-preview-flag ops-preview-flag--neutral">Additional products</span>
          ) : null}
          {!form.special_equipment && !form.access_notes && !form.additional_products && !form.first_year_customer_flag && !form.flagship_priority_account_flag && !form.weather_travel_risk_flag ? (
            <span className="ops-preview-flag ops-preview-flag--neutral">No special flags yet</span>
          ) : null}
        </div>

        <div className="leadership-shoot-workspace__sync-card">
          <div>
            <div className="eyebrow">Outlook Sync</div>
            <strong>{integrationState ? humanizeLabel(integrationState.sync_state) : "Not linked yet"}</strong>
            <div className="muted">
              {integrationState?.source_of_truth ?? "Mission Control owns staffing and operational fields until leadership explicitly pushes or links Outlook."}
            </div>
          </div>
          <div className="preview-detail-panel__actions">
            {selectedShootId ? (
              <button className="secondary-button" disabled={syncingOutlook || !canManage} onClick={() => void pushToOutlook()}>
                {syncingOutlook ? "Queueing..." : "Queue Outlook Push"}
              </button>
            ) : (
              <span className="meta-pill">Save the Shoot first</span>
            )}
          </div>
        </div>
      </OperationalDetailSection>

      <OperationalDetailSection
        title="Connected Core Context"
        summary="The Shoot stays ready for later Resource Library, Agreement, Post-Shoot Evaluation, Gear, and Labor modules without changing the canonical layout again."
      >
        <div className="detail-two-column">
          <div className="request-card">
            <strong>Resource Library</strong>
            <div className="muted">
              {selectedDetail?.resource_library?.summary
                ? `${selectedDetail.resource_library.summary.total_items} items already linked to this Shoot.`
                : "Placeholder for Shoot-linked documents, references, and media history."}
            </div>
          </div>
          <div className="request-card">
            <strong>Post-Shoot Evaluation</strong>
            <div className="muted">Placeholder for the submitted evaluation summary and follow-through state.</div>
          </div>
          <div className="request-card">
            <strong>Agreement Warning</strong>
            <div className="muted">
              {selectedDetail?.agreement_warning_summary ?? "Agreement coverage warnings will surface here without blocking scheduling."}
            </div>
          </div>
          <div className="request-card">
            <strong>Gear</strong>
            <div className="muted">
              {form.special_equipment.trim()
                ? `Special equipment currently noted: ${form.special_equipment.trim()}`
                : "Future Asset and Kit linkage will attach here when gear workflows are connected directly to the Shoot."}
            </div>
          </div>
          <div className="request-card">
            <strong>Labor</strong>
            <div className="muted">
              {selectedShootId
                ? "Published shifts, attendance exceptions, and future Time Session detail will stay attached here."
                : "Save the Shoot to attach staffing, attendance, and later labor summaries."}
            </div>
          </div>
        </div>
      </OperationalDetailSection>

      <div className="schedule-sidebar-actions leadership-shoot-workspace__footer">
        <button className="secondary-button" onClick={resetWorkspace}>
          {selectedShootId ? "Start New Shoot" : "Reset Workspace"}
        </button>
        {selectedShootId ? (
          <button className="secondary-button" onClick={() => onSelectShoot(null)}>
            Close Editing
          </button>
        ) : null}
        <button
          className="primary-button"
          disabled={saving || !form.shoot_code || !form.title || !form.organization_id || !form.location_id || !form.primary_contact_id}
          onClick={() => void saveWorkspace()}
        >
          {saving ? "Saving..." : selectedShootId ? "Save Shoot" : "Create Shoot"}
        </button>
      </div>
      </section>
      <ChecklistTransitionBlockModal
        open={Boolean(checklistValidation)}
        validation={checklistValidation}
        canOverride={canOverrideChecklistBlock && Boolean(checklistValidation?.soft_blocked)}
        overrideReason={checklistOverrideReason}
        busy={saving}
        onOverrideReasonChange={setChecklistOverrideReason}
        onClose={() => {
          setChecklistValidation(null);
          setPendingChecklistPayload(null);
          setChecklistOverrideReason("");
        }}
        onConfirmOverride={() => void handleChecklistOverrideSave()}
      />
    </>
  );
}
