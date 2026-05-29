import type { PoolClient } from "pg";
import { config } from "../config.js";
import type { AuthUser } from "../types/auth.js";
import { ApiError } from "../errors/apiError.js";
import type {
  EvaluationSubmitInput,
  LocationComplianceAlert,
  LocationHistoricalContext,
  LocationPhotographerPerformanceRow,
  MondayLocationIntegrationState,
  LocationTopRatedRow,
  ShootLocationDetail,
  ShootLocationEvaluation,
  ShootLocationIntelligence,
  ShootLocationPhoto,
  ShootLocationSummary,
  SetupPhotoUploadInput
} from "../types/locations.js";
import { createAuditLog } from "./audit.js";
import {
  markIntegrationSyncOperationFailed,
  markIntegrationSyncOperationSucceeded,
  queueIntegrationSyncOperation
} from "./integrationSync.js";
import {
  ensureLocationCatalogFresh,
  findLocationCandidates,
  getLocationRecordById,
  inferLocationCategory,
  isMondayProtectedImageUrl,
  listLocationAreas,
  listLocationRecords,
  normalizeLocationText,
  type ShootLocationRecord
} from "./locationCatalog.js";
import {
  createMondayEvaluation,
  listHistoricalLocationEvaluations,
  proxyMondayProtectedImage,
  uploadMondayLocationPhoto
} from "./locationMonday.js";
import { haversineMiles } from "./geo.js";
import { assertShootAccess } from "./shootAccess.js";
import {
  getLocationResourceLibrary,
  upsertResourceLibraryItemFromSource
} from "./resourceLibrary.js";
import { listLocationMemoryNotesForLocation } from "./operationalNotes.js";
import { hasAuthorityTier } from "../authz/authority.js";
import { isFieldRole } from "../authz/policy.js";

type LocalEvaluationRow = {
  id: string;
  location_id: string;
  monday_item_id: string | null;
  shift_id: string | null;
  shoot_name: string;
  shoot_date: string;
  photographer_name: string;
  shoot_type: string;
  eval_status: string | null;
  overall_outcome: string | null;
  staffing_fit: string | null;
  setup_difficulty: string | null;
  customer_school_readiness: string | null;
  data_roster_readiness: string | null;
  equipment_workflow_issue: string | null;
  started_on_time: boolean | null;
  short_summary_note: string | null;
  next_time_recommendation: string | null;
  follow_up_required: boolean | null;
  major_issue_flag: boolean | null;
  location_memory_update_suggested: boolean | null;
  leadership_review_needed: boolean | null;
  issue_category: string | null;
  top_watch_out: string | null;
  location_memory_promotion_text: string | null;
  recommended_staffing_next_time: number | null;
  recommended_arrival_buffer_minutes: number | null;
  recommended_room_setup_change: string | null;
  special_gear_needed_next_time: string | null;
  customer_follow_up_needed: boolean | null;
  reviewed_at: string | null;
  closed_at: string | null;
  on_time: string;
  easy_access: string;
  overall_rating: number;
  photos_uploaded: string;
  late_details: string | null;
  access_details: string | null;
  notes: string | null;
  outreach_notes: string | null;
  recommendations: string | null;
  image_quality: string | null;
  created_at: string;
};

type LocalPhotoRow = {
  id: string;
  location_id: string;
  shoot_id: string | null;
  outlook_event_id: string | null;
  monday_item_id: string | null;
  monday_asset_id: string | null;
  uploader_name: string;
  file_name: string;
  photo_category: string | null;
  caption: string | null;
  promote_to_location_memory: boolean | null;
  memory_state: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  image_url: string;
  source: string;
  uploaded_at: string;
};

type LocationLinkRow = {
  id: string;
  shoot_id: string | null;
  outlook_event_id: string | null;
  location_id: string;
  match_source: string;
  confidence: number | null;
};

type AreaCountRow = {
  location_id: string;
  count: string;
};

type ShootRow = {
  id: string;
  shoot_code: string;
  title: string;
  location_name: string;
  location_address: string | null;
  arrival_time: string | null;
  start_time: string | null;
  end_time_est: string | null;
};

type AlertRow = {
  id: string;
  alert_type: string;
  message: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
};

type OutlookLocationPreview = {
  matched_location_id: string | null;
  match_source: "manual" | "fuzzy" | "none";
  confidence: number;
  matched_location_name: string | null;
  matched_location_address: string | null;
  setup_photo_count: number;
  evaluation_count: number;
  avg_rating: number | null;
  on_time_percent: number;
  easy_access_percent: number;
  latest_recommendation: string | null;
  suggestions: Awaited<ReturnType<typeof findLocationCandidates>>;
  warning_alert_open: boolean;
};

export async function listShootLocations(
  client: PoolClient,
  auth: AuthUser,
  filters: {
    search?: string | null;
    category?: string | null;
    sort?: "alpha" | "top_rated" | "nearby";
    latitude?: number | null;
    longitude?: number | null;
  } = {}
) {
  const dataset = await loadLocationDataset(client, auth.tenantId);
  const search = normalizeLocationText(filters.search);
  const category = (filters.category ?? "all").toLowerCase();
  let rows = dataset.summaries;

  if (search) {
    rows = rows.filter((location) =>
      normalizeLocationText([location.name, location.address, location.location_details, location.commentary].filter(Boolean).join(" ")).includes(search)
    );
  }

  if (category !== "all") {
    rows = rows.filter((location) => location.category === category);
  }

  const withDistance = rows.map((location) => ({
    ...location,
    distance_miles:
      typeof filters.latitude === "number" &&
      typeof filters.longitude === "number" &&
      typeof location.latitude === "number" &&
      typeof location.longitude === "number"
        ? haversineMiles(filters.latitude, filters.longitude, location.latitude, location.longitude)
        : null
  }));

  const sort = filters.sort ?? "alpha";
  if (sort === "top_rated") {
    withDistance.sort((left, right) => {
      const ratingDelta = Number(right.stats.avg_rating ?? 0) - Number(left.stats.avg_rating ?? 0);
      if (ratingDelta !== 0) {
        return ratingDelta;
      }
      return right.stats.evaluation_count - left.stats.evaluation_count;
    });
  } else if (sort === "nearby") {
    withDistance.sort((left, right) => {
      if (left.distance_miles === null && right.distance_miles === null) {
        return left.name.localeCompare(right.name);
      }
      if (left.distance_miles === null) {
        return 1;
      }
      if (right.distance_miles === null) {
        return -1;
      }
      return left.distance_miles - right.distance_miles;
    });
  } else {
    withDistance.sort((left, right) => left.name.localeCompare(right.name));
  }

  return {
    locations: withDistance,
    cache: dataset.cache
  };
}

export async function getShootLocationDetail(client: PoolClient, auth: AuthUser, locationId: string): Promise<ShootLocationDetail | null> {
  const dataset = await loadLocationDataset(client, auth.tenantId);
  const summary = dataset.summaryById.get(locationId);
  const record = dataset.recordById.get(locationId);
  if (!summary || !record) {
    return null;
  }

  const areas = await listLocationAreas(client, auth.tenantId, locationId);
  const photoGallery = buildPhotoGallery(record, dataset.photosByLocationId.get(locationId) ?? []);
  const evaluations = [...(dataset.evaluationsByLocationId.get(locationId) ?? [])].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
  );
  const resourceLibrary = await getLocationResourceLibrary(client, auth, locationId);
  const locationMemory = await listLocationMemoryNotesForLocation(client, auth, locationId, { limit: 8 });
  const locationMemorySummary = buildLocationMemorySummary({
    detail: summary,
    memoryNotes: locationMemory.notes,
    recentPhotos: photoGallery,
    evaluations
  });

  return {
    ...summary,
    areas: areas.map((area) => ({
      id: area.id,
      name: area.name,
      location_details: area.location_details,
      commentary: area.commentary,
      photo_urls: area.photo_urls.map(toProxyableImageUrl)
    })),
    photo_gallery: photoGallery,
    evaluations,
    resource_library: resourceLibrary,
    location_memory: locationMemorySummary,
    historical_context: buildHistoricalContext({
      summary,
      locationMemory: locationMemorySummary,
      memoryNotes: locationMemory.notes,
      evaluations,
      photos: photoGallery
    })
  };
}

export async function getTopRatedShootLocations(client: PoolClient, auth: AuthUser): Promise<LocationTopRatedRow[]> {
  const dataset = await loadLocationDataset(client, auth.tenantId);
  return [...dataset.summaries]
    .filter((location) => location.stats.evaluation_count > 0)
    .sort((left, right) => {
      const ratingDelta = Number(right.stats.avg_rating ?? 0) - Number(left.stats.avg_rating ?? 0);
      if (ratingDelta !== 0) {
        return ratingDelta;
      }
      return right.stats.evaluation_count - left.stats.evaluation_count;
    })
    .slice(0, 12)
    .map((location) => ({
      location_id: location.id,
      location_name: location.name,
      address: location.address,
      avg_rating: location.stats.avg_rating,
      evaluation_count: location.stats.evaluation_count,
      easy_access_percent: location.stats.easy_access_percent,
      on_time_percent: location.stats.on_time_percent
    }));
}

export async function getPhotographerLocationPerformance(
  client: PoolClient,
  auth: AuthUser
): Promise<LocationPhotographerPerformanceRow[]> {
  const dataset = await loadLocationDataset(client, auth.tenantId);
  const grouped = new Map<
    string,
    {
      evaluations: ShootLocationEvaluation[];
      latestLocationName: string | null;
      latestShootDate: string | null;
    }
  >();

  for (const summary of dataset.summaries) {
    for (const evaluation of dataset.evaluationsByLocationId.get(summary.id) ?? []) {
      const key = evaluation.photographer_name.trim().toLowerCase();
      const existing = grouped.get(key);
      if (existing) {
        existing.evaluations.push(evaluation);
        if (!existing.latestShootDate || new Date(evaluation.shoot_date).getTime() > new Date(existing.latestShootDate).getTime()) {
          existing.latestShootDate = evaluation.shoot_date;
          existing.latestLocationName = summary.name;
        }
      } else {
        grouped.set(key, {
          evaluations: [evaluation],
          latestLocationName: summary.name,
          latestShootDate: evaluation.shoot_date
        });
      }
    }
  }

  return [...grouped.entries()]
    .map(([nameKey, row]) => {
      const base = computeStats(row.evaluations, row.evaluations.length);
      return {
        photographer_name: row.evaluations[0]?.photographer_name ?? nameKey,
        evaluation_count: row.evaluations.length,
        avg_rating: base.avg_rating,
        on_time_percent: base.on_time_percent,
        easy_access_percent: base.easy_access_percent,
        latest_location_name: row.latestLocationName,
        latest_shoot_date: row.latestShootDate
      };
    })
    .sort((left, right) => {
      const ratingDelta = Number(right.avg_rating ?? 0) - Number(left.avg_rating ?? 0);
      if (ratingDelta !== 0) {
        return ratingDelta;
      }
      return right.evaluation_count - left.evaluation_count;
    });
}

async function loadLocationDataset(client: PoolClient, tenantId: string) {
  const cache = await ensureLocationCatalogFresh(client, tenantId);
  const records = await listLocationRecords(client, tenantId);
  const areaCountMap = await loadAreaCountMap(client, tenantId);
  const localEvaluations = await loadLocalEvaluations(client, tenantId);
  const localPhotos = await loadLocalPhotos(client, tenantId);
  const baseSummaries = records.map((record) => buildEmptySummary(record));
  const mondayEvaluations = await listHistoricalLocationEvaluations(baseSummaries);
  const localEvaluationMap = groupBy(localEvaluations, (row) => row.location_id);
  const localPhotoMap = groupBy(localPhotos, (row) => row.location_id);

  const evaluationsByLocationId = new Map<string, ShootLocationEvaluation[]>();
  for (const record of records) {
    const missionControlRows = (localEvaluationMap.get(record.id) ?? []).map(mapLocalEvaluation);
    const mondayRows = mondayEvaluations.get(record.id) ?? [];
    const combined = [...mondayRows, ...missionControlRows].sort(
      (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
    );
    evaluationsByLocationId.set(record.id, combined);
  }

  const summaries = records.map((record) => {
    const evaluations = evaluationsByLocationId.get(record.id) ?? [];
    const photos = localPhotoMap.get(record.id) ?? [];
    const stats = computeStats(evaluations, record.photo_urls.length + photos.length);
    const latestRecommendation = evaluations.find((row) => row.recommendations)?.recommendations ?? null;
    return {
      ...buildEmptySummary(record),
      stats,
      photo_count: record.photo_urls.length + photos.length,
      area_count: areaCountMap.get(record.id) ?? 0,
      latest_recommendation: latestRecommendation,
      integration: buildLocationIntegrationState({
        fetchedAt: cache.fetchedAt,
        evaluations,
        photos
      })
    } satisfies ShootLocationSummary;
  });

  return {
    cache,
    summaries,
    summaryById: new Map(summaries.map((summary) => [summary.id, summary])),
    recordById: new Map(records.map((record) => [record.id, record])),
    evaluationsByLocationId,
    photosByLocationId: localPhotoMap
  };
}

function buildEmptySummary(
  record: ShootLocationRecord
): Omit<ShootLocationSummary, "stats" | "photo_count" | "area_count" | "latest_recommendation" | "integration"> & {
  integration: null;
} {
  return {
    id: record.id,
    name: record.name,
    address: record.address,
    location_details: record.location_details,
    commentary: record.commentary,
    custodian_contact: record.custodian_contact,
    category: inferLocationCategory({ name: record.name, address: record.address }),
    navigation_url: record.navigation_url,
    latitude: record.latitude,
    longitude: record.longitude,
    estimated_drive_minutes: record.estimated_drive_minutes,
    integration: null
  };
}

function buildMondayItemUrl(mondayItemId: string | null) {
  if (!mondayItemId || !config.MONDAY_ITEM_URL_TEMPLATE) {
    return null;
  }
  if (config.MONDAY_ITEM_URL_TEMPLATE.includes("{itemId}")) {
    return config.MONDAY_ITEM_URL_TEMPLATE.replace("{itemId}", encodeURIComponent(mondayItemId));
  }
  return `${config.MONDAY_ITEM_URL_TEMPLATE}${encodeURIComponent(mondayItemId)}`;
}

function buildLocationIntegrationState(input: {
  fetchedAt: string | null;
  evaluations: ShootLocationEvaluation[];
  photos: LocalPhotoRow[];
}): MondayLocationIntegrationState {
  const mondayEvaluations = input.evaluations.filter((evaluation) => evaluation.source !== "mission_control");
  const missionControlEvaluations = input.evaluations.filter((evaluation) => evaluation.source === "mission_control");
  const mondayPhotos = input.photos.filter((photo) => photo.source === "monday" || Boolean(photo.monday_item_id));
  const missionControlPhotos = input.photos.filter((photo) => photo.source === "mission_control");
  const mondayItemId =
    mondayEvaluations.find((evaluation) => evaluation.monday_item_id)?.monday_item_id ??
    mondayPhotos.find((photo) => photo.monday_item_id)?.monday_item_id ??
    null;
  const mondayLinked = mondayEvaluations.length > 0 || mondayPhotos.length > 0 || Boolean(mondayItemId);
  const missionControlOwned = missionControlEvaluations.length > 0 || missionControlPhotos.length > 0;
  const migrationState = mondayLinked
    ? missionControlOwned
      ? "partially_migrated"
      : "coexisting"
    : missionControlOwned
      ? "mission_control_owned"
      : "not_yet_migrated";
  const warnings =
    migrationState === "partially_migrated"
      ? [
          "Mission Control is adding new field context here, but some workflow checkpoints still come from Monday.",
          "Edit only Mission Control-owned notes here until the legacy board ownership transfers."
        ]
      : migrationState === "coexisting"
        ? [
            "This location still depends on Monday-linked history for part of its operational context.",
            "Some legacy board states remain read-only until migration is complete."
          ]
        : migrationState === "not_yet_migrated"
          ? [
              "This location has not fully migrated yet.",
              "Use the linked Monday workflow if the legacy board still owns the active process."
            ]
          : ["Mission Control owns the active field context here."];

  return {
    provider: "monday",
    link_state: mondayLinked ? "linked" : "not_linked",
    migration_state: migrationState,
    last_synced_at: mondayLinked ? input.fetchedAt : null,
    monday_item_id: mondayItemId,
    monday_item_url: buildMondayItemUrl(mondayItemId),
    externally_controlled_fields: mondayLinked ? ["Legacy workflow state", "Automation checkpoints", "Historical board metadata"] : [],
    source_label:
      migrationState === "partially_migrated"
        ? "Mission Control and Monday are coexisting on this record."
        : migrationState === "coexisting"
          ? "Monday still owns part of this legacy workflow."
          : migrationState === "not_yet_migrated"
            ? "Mission Control is showing placeholder context until ownership transfers."
            : "Mission Control owns the active field context here.",
    warnings
  };
}

async function loadAreaCountMap(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<AreaCountRow>(
    `
      SELECT location_id, count(*)::text AS count
      FROM shoot_location_area
      WHERE tenant_id = $1
      GROUP BY location_id
    `,
    [tenantId]
  );
  return new Map(rows.map((row) => [row.location_id, Number(row.count ?? 0)]));
}

async function loadLocalEvaluations(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<LocalEvaluationRow>(
    `
      SELECT
        id,
        location_id,
        monday_item_id,
        shift_id::text,
        shoot_name,
        shoot_date::text,
        photographer_name,
        shoot_type,
        eval_status::text,
        overall_outcome::text,
        staffing_fit::text,
        setup_difficulty::text,
        customer_school_readiness::text,
        data_roster_readiness::text,
        equipment_workflow_issue::text,
        started_on_time,
        short_summary_note,
        next_time_recommendation,
        follow_up_required,
        major_issue_flag,
        location_memory_update_suggested,
        leadership_review_needed,
        issue_category::text,
        top_watch_out,
        location_memory_promotion_text,
        recommended_staffing_next_time,
        recommended_arrival_buffer_minutes,
        recommended_room_setup_change,
        special_gear_needed_next_time,
        customer_follow_up_needed,
        reviewed_at::text,
        closed_at::text,
        on_time,
        easy_access,
        overall_rating,
        photos_uploaded,
        late_details,
        access_details,
        notes,
        outreach_notes,
        recommendations,
        image_quality,
        created_at::text
      FROM post_shoot_evaluation
      WHERE tenant_id = $1
      ORDER BY shoot_date DESC, created_at DESC
    `,
    [tenantId]
  );
  return rows;
}

async function loadLocalPhotos(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<LocalPhotoRow>(
    `
      SELECT
        id,
        location_id,
        shoot_id,
        outlook_event_id,
        monday_item_id,
        monday_asset_id,
        uploader_name,
        file_name,
        photo_category::text,
        caption,
        promote_to_location_memory,
        memory_state::text,
        reviewed_at::text,
        review_note,
        image_url,
        source,
        uploaded_at::text
      FROM setup_photo_upload
      WHERE tenant_id = $1
      ORDER BY uploaded_at DESC, created_at DESC
    `,
    [tenantId]
  );
  return rows;
}

function mapLocalEvaluation(row: LocalEvaluationRow): ShootLocationEvaluation {
  return {
    id: row.id,
    source: "mission_control",
    monday_item_id: row.monday_item_id,
    shift_id: row.shift_id,
    eval_status: row.eval_status as ShootLocationEvaluation["eval_status"],
    shoot_name: row.shoot_name,
    shoot_date: row.shoot_date,
    photographer_name: row.photographer_name,
    shoot_type: row.shoot_type,
    overall_outcome: row.overall_outcome as ShootLocationEvaluation["overall_outcome"],
    staffing_fit: row.staffing_fit as ShootLocationEvaluation["staffing_fit"],
    setup_difficulty: row.setup_difficulty as ShootLocationEvaluation["setup_difficulty"],
    customer_school_readiness: row.customer_school_readiness as ShootLocationEvaluation["customer_school_readiness"],
    data_roster_readiness: row.data_roster_readiness as ShootLocationEvaluation["data_roster_readiness"],
    equipment_workflow_issue: row.equipment_workflow_issue as ShootLocationEvaluation["equipment_workflow_issue"],
    started_on_time: row.started_on_time,
    short_summary_note: row.short_summary_note,
    next_time_recommendation: row.next_time_recommendation,
    follow_up_required: Boolean(row.follow_up_required),
    major_issue_flag: Boolean(row.major_issue_flag),
    location_memory_update_suggested: Boolean(row.location_memory_update_suggested),
    leadership_review_needed: Boolean(row.leadership_review_needed),
    issue_category: row.issue_category as ShootLocationEvaluation["issue_category"],
    top_watch_out: row.top_watch_out,
    location_memory_promotion_text: row.location_memory_promotion_text,
    recommended_staffing_next_time:
      typeof row.recommended_staffing_next_time === "number" ? row.recommended_staffing_next_time : row.recommended_staffing_next_time == null ? null : Number(row.recommended_staffing_next_time),
    recommended_arrival_buffer_minutes:
      typeof row.recommended_arrival_buffer_minutes === "number"
        ? row.recommended_arrival_buffer_minutes
        : row.recommended_arrival_buffer_minutes == null
          ? null
          : Number(row.recommended_arrival_buffer_minutes),
    recommended_room_setup_change: row.recommended_room_setup_change,
    special_gear_needed_next_time: row.special_gear_needed_next_time,
    customer_follow_up_needed: Boolean(row.customer_follow_up_needed),
    reviewed_at: row.reviewed_at,
    closed_at: row.closed_at,
    on_time: row.on_time,
    easy_access: row.easy_access,
    overall_rating: Number(row.overall_rating ?? 0),
    photos_uploaded: row.photos_uploaded,
    late_details: row.late_details,
    access_details: row.access_details,
    notes: row.notes,
    outreach_notes: row.outreach_notes,
    recommendations: row.recommendations,
    image_quality: row.image_quality,
    submitted_by_name: "Mission Control",
    created_at: row.created_at
  };
}

function buildPhotoGallery(record: ShootLocationRecord, localPhotos: LocalPhotoRow[]): ShootLocationPhoto[] {
  const catalogPhotos = record.photo_urls.map((url, index) => ({
    id: `catalog-${record.id}-${index}`,
    image_url: toProxyableImageUrl(url),
    source: "catalog" as const,
    caption: "Catalog setup reference",
    uploaded_at: record.last_catalog_sync_at,
    uploader_name: "Location Guide"
  }));

  const uploadedPhotos = localPhotos.map((photo) => ({
    id: photo.id,
    image_url: toProxyableImageUrl(photo.image_url),
    source: photo.monday_item_id ? ("monday" as const) : ("mission_control" as const),
    caption: photo.caption || photo.file_name,
    photo_category: photo.photo_category as ShootLocationPhoto["photo_category"],
    memory_state: photo.memory_state as ShootLocationPhoto["memory_state"],
    promote_to_location_memory: Boolean(photo.promote_to_location_memory),
    reviewed_at: photo.reviewed_at,
    review_note: photo.review_note,
    uploaded_at: photo.uploaded_at,
    uploader_name: photo.uploader_name,
    monday_asset_id: photo.monday_asset_id
  }));

  return [...uploadedPhotos, ...catalogPhotos];
}

function computeStats(evaluations: ShootLocationEvaluation[], photoCount: number) {
  if (!evaluations.length) {
    return {
      avg_rating: null,
      on_time_percent: 0,
      easy_access_percent: 0,
      evaluation_count: 0,
      setup_photo_count: photoCount
    };
  }

  const totals = evaluations.reduce(
    (accumulator, evaluation) => {
      accumulator.rating += Number(evaluation.overall_rating ?? 0);
      accumulator.onTime += evaluation.on_time === "Yes" ? 1 : 0;
      accumulator.easyAccess += evaluation.easy_access === "Yes" ? 1 : 0;
      return accumulator;
    },
    { rating: 0, onTime: 0, easyAccess: 0 }
  );

  return {
    avg_rating: Number((totals.rating / evaluations.length).toFixed(2)),
    on_time_percent: Math.round((totals.onTime / evaluations.length) * 100),
    easy_access_percent: Math.round((totals.easyAccess / evaluations.length) * 100),
    evaluation_count: evaluations.length,
    setup_photo_count: photoCount
  };
}

function buildLocationMemorySummary(input: {
  detail: ShootLocationSummary;
  memoryNotes: Awaited<ReturnType<typeof listLocationMemoryNotesForLocation>>["notes"];
  recentPhotos: ShootLocationPhoto[];
  evaluations: ShootLocationEvaluation[];
}) {
  const publishedNotes = input.memoryNotes.filter((note) => note.publication_state === "active" && !note.archived_at);
  const latestPublished = publishedNotes[0] ?? null;
  const lastConfirmedCandidates = [
    latestPublished?.promotion_published_at ?? latestPublished?.updated_at ?? latestPublished?.created_at ?? null,
    input.recentPhotos[0]?.uploaded_at ?? null,
    input.evaluations[0]?.reviewed_at ?? input.evaluations[0]?.created_at ?? null
  ].filter(Boolean) as string[];
  const lastConfirmedAt = lastConfirmedCandidates.length
    ? [...lastConfirmedCandidates].sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0]
    : null;
  const needsRefresh =
    !lastConfirmedAt || Date.now() - new Date(lastConfirmedAt).getTime() > 365 * 24 * 60 * 60 * 1000 || input.memoryNotes.some((note) => note.publication_state === "proposed");

  return {
    status: (publishedNotes.length ? (needsRefresh ? "needs_refresh" : "active") : "needs_refresh") as "active" | "needs_refresh" | "archived",
    last_confirmed_at: lastConfirmedAt,
    last_updated_by: latestPublished?.author_name ?? null,
    where_to_go: input.detail.address ?? input.detail.name,
    where_to_park: input.detail.commentary ?? publishedNotes[0]?.body ?? null,
    where_to_set_up: input.detail.location_details ?? null,
    top_watch_out: publishedNotes.find((note) => note.pinned)?.body ?? input.detail.latest_recommendation ?? publishedNotes[0]?.body ?? null,
    notes: input.memoryNotes.map((note) => ({
      id: note.id,
      body: note.body,
      pinned: Boolean(note.pinned),
      publication_state: note.publication_state,
      created_at: note.created_at,
      updated_at: note.updated_at,
      author_name: note.author_name ?? null,
      can_publish_location_memory: Boolean(note.can_publish_location_memory)
    })),
    setup_photos: input.recentPhotos.slice(0, 4)
  };
}

function buildHistoricalContext(input: {
  summary: ShootLocationSummary;
  locationMemory: ReturnType<typeof buildLocationMemorySummary>;
  memoryNotes: Awaited<ReturnType<typeof listLocationMemoryNotesForLocation>>["notes"];
  evaluations: ShootLocationEvaluation[];
  photos: ShootLocationPhoto[];
}): LocationHistoricalContext {
  const publishedNotes = input.memoryNotes.filter((note) => note.publication_state === "active" && !note.archived_at);
  const proposedNotes = input.memoryNotes.filter((note) => note.publication_state === "proposed" && !note.archived_at);
  const evidencePhotos = prioritizeHistoricalPhotos(input.photos);
  const nonCatalogPhotos = evidencePhotos.filter((photo) => photo.source !== "catalog");
  const firstTimeLocation = input.evaluations.length === 0 && publishedNotes.length === 0 && nonCatalogPhotos.length === 0;
  const recentComparable = selectComparableEvaluations(input.evaluations);
  const patternSignals = buildRepeatPatternSignals(recentComparable);
  const lastEvaluation = input.evaluations[0] ?? null;
  const openFollowUps = buildHistoricalFollowUps({
    evaluations: input.evaluations,
    proposedNotes,
    photos: evidencePhotos
  });
  const watchOuts = collectTopWatchOuts({
    locationMemory: input.locationMemory,
    evaluations: input.evaluations,
    patternSignals
  });
  const trustSource: LocationHistoricalContext["quick_context"]["trust_source"] =
    publishedNotes.length > 0
      ? "reviewed_memory"
      : patternSignals.length > 0
        ? "repeated_pattern"
        : input.evaluations.length > 0
          ? "recent_eval"
          : "no_history";

  return {
    quick_context: {
      first_time_location: firstTimeLocation,
      total_prior_visits: countDistinctPriorVisits(input.evaluations),
      last_visit_date: lastEvaluation?.shoot_date ?? null,
      last_confirmed_memory_date: input.locationMemory.last_confirmed_at,
      top_watch_outs: watchOuts,
      recommended_arrival_buffer_minutes: deriveRecommendedArrivalBuffer(input.evaluations),
      recommended_staffing_note: deriveRecommendedStaffingNote(input.evaluations, patternSignals),
      freshness_state: deriveHistoricalFreshnessState(input.locationMemory),
      memory_status: input.locationMemory.status,
      open_issue_count: openFollowUps.length,
      trust_source: trustSource
    },
    last_time_here: lastEvaluation
      ? {
          shoot_date: lastEvaluation.shoot_date,
          shoot_type: lastEvaluation.shoot_type,
          overall_outcome: lastEvaluation.overall_outcome ?? null,
          staffing_fit: lastEvaluation.staffing_fit ?? null,
          setup_difficulty: lastEvaluation.setup_difficulty ?? null,
          major_issue: Boolean(lastEvaluation.major_issue_flag),
          next_time_recommendation:
            lastEvaluation.next_time_recommendation ??
            lastEvaluation.top_watch_out ??
            lastEvaluation.recommendations ??
            lastEvaluation.short_summary_note ??
            null,
          setup_photos_exist: nonCatalogPhotos.length > 0
        }
      : null,
    repeat_pattern_signals: patternSignals,
    open_follow_ups: openFollowUps,
    setup_visuals: {
      photos: evidencePhotos.slice(0, 4),
      top_setup_instruction:
        lastEvaluation?.recommended_room_setup_change ??
        input.locationMemory.where_to_set_up ??
        input.summary.location_details ??
        null,
      top_load_in_instruction:
        input.locationMemory.where_to_park ??
        input.summary.commentary ??
        input.locationMemory.top_watch_out ??
        null
    },
    recent_comparable_shoots: recentComparable.slice(0, 5).map((evaluation) => ({
      id: evaluation.id,
      shoot_name: evaluation.shoot_name,
      shoot_date: evaluation.shoot_date,
      shoot_type: evaluation.shoot_type,
      overall_outcome: evaluation.overall_outcome ?? null,
      staffing_fit: evaluation.staffing_fit ?? null,
      setup_difficulty: evaluation.setup_difficulty ?? null,
      issue_category: evaluation.issue_category ?? null,
      next_time_recommendation:
        evaluation.next_time_recommendation ??
        evaluation.top_watch_out ??
        evaluation.recommendations ??
        evaluation.short_summary_note ??
        null,
      major_issue: Boolean(evaluation.major_issue_flag)
    }))
  };
}

function deriveHistoricalFreshnessState(
  locationMemory: ReturnType<typeof buildLocationMemorySummary>
): "fresh" | "aging" | "needs_refresh" {
  if (locationMemory.status === "archived" || locationMemory.status === "needs_refresh" || !locationMemory.last_confirmed_at) {
    return "needs_refresh";
  }
  const ageMs = Date.now() - new Date(locationMemory.last_confirmed_at).getTime();
  if (!Number.isFinite(ageMs) || ageMs > 365 * 24 * 60 * 60 * 1000) {
    return "needs_refresh";
  }
  if (ageMs > 180 * 24 * 60 * 60 * 1000) {
    return "aging";
  }
  return "fresh";
}

function countDistinctPriorVisits(evaluations: ShootLocationEvaluation[]) {
  return new Set(evaluations.map((evaluation) => `${evaluation.shoot_date}|${evaluation.shoot_name}`)).size;
}

function deriveRecommendedArrivalBuffer(evaluations: ShootLocationEvaluation[]) {
  for (const evaluation of evaluations) {
    if (typeof evaluation.recommended_arrival_buffer_minutes === "number" && Number.isFinite(evaluation.recommended_arrival_buffer_minutes)) {
      return evaluation.recommended_arrival_buffer_minutes;
    }
  }
  return null;
}

function deriveRecommendedStaffingNote(
  evaluations: ShootLocationEvaluation[],
  patternSignals: Array<{ key: string; label: string }>
) {
  for (const evaluation of evaluations) {
    if (typeof evaluation.recommended_staffing_next_time === "number" && Number.isFinite(evaluation.recommended_staffing_next_time)) {
      return `Plan ${evaluation.recommended_staffing_next_time} staff next time.`;
    }
  }
  if (patternSignals.some((signal) => signal.key === "repeated_understaffing")) {
    return "Increase staffing coverage or add a stronger backup plan next time.";
  }
  if (patternSignals.some((signal) => signal.key === "repeated_traffic_flow")) {
    return "Add check-in support or lane management for arrival flow.";
  }
  return null;
}

function selectComparableEvaluations(evaluations: ShootLocationEvaluation[]) {
  if (evaluations.length <= 1) {
    return evaluations;
  }
  const latestShootType = evaluations[0]?.shoot_type ?? null;
  const sameType = latestShootType ? evaluations.filter((evaluation) => evaluation.shoot_type === latestShootType) : [];
  return (sameType.length >= 2 ? sameType : evaluations).slice(0, 5);
}

function buildRepeatPatternSignals(
  evaluations: ShootLocationEvaluation[]
): Array<{
  key: string;
  label: string;
  detail: string;
  evidence_count: number;
  severity: "info" | "warning" | "high";
  source: "repeated_structured_pattern";
}> {
  if (evaluations.length < 2) {
    return [];
  }
  const signals: Array<{
    key: string;
    label: string;
    detail: string;
    evidence_count: number;
    severity: "info" | "warning" | "high";
    source: "repeated_structured_pattern";
  }> = [];

  const repeatedUnderstaffed = evaluations.filter((evaluation) => evaluation.staffing_fit === "understaffed").length;
  if (repeatedUnderstaffed >= 2) {
    signals.push({
      key: "repeated_understaffing",
      label: "Repeated understaffing",
      detail: `${repeatedUnderstaffed} recent comparable shoots were marked understaffed.`,
      evidence_count: repeatedUnderstaffed,
      severity: "high",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedSetupDifficulty = evaluations.filter((evaluation) => evaluation.setup_difficulty === "high").length;
  if (repeatedSetupDifficulty >= 2) {
    signals.push({
      key: "repeated_setup_difficulty",
      label: "Repeated setup difficulty",
      detail: `${repeatedSetupDifficulty} recent comparable shoots reported high setup difficulty.`,
      evidence_count: repeatedSetupDifficulty,
      severity: "warning",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedDataIssues = evaluations.filter(
    (evaluation) => evaluation.data_roster_readiness === "minor_friction" || evaluation.data_roster_readiness === "major_friction"
  ).length;
  if (repeatedDataIssues >= 2) {
    signals.push({
      key: "repeated_data_roster_issues",
      label: "Recurring data / roster friction",
      detail: `${repeatedDataIssues} recent comparable shoots hit data or roster readiness issues.`,
      evidence_count: repeatedDataIssues,
      severity: "high",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedParking = evaluations.filter((evaluation) => evaluation.issue_category === "parking_load_in").length;
  if (repeatedParking >= 2) {
    signals.push({
      key: "repeated_parking_load_in",
      label: "Recurring entrance or parking confusion",
      detail: `${repeatedParking} recent comparable shoots flagged parking or load-in trouble.`,
      evidence_count: repeatedParking,
      severity: "warning",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedTraffic = evaluations.filter(
    (evaluation) => evaluation.issue_category === "line_flow_traffic" || evaluation.issue_category === "student_parent_flow"
  ).length;
  if (repeatedTraffic >= 2) {
    signals.push({
      key: "repeated_traffic_flow",
      label: "Recurring traffic-flow issue",
      detail: `${repeatedTraffic} recent comparable shoots reported line-flow or traffic problems.`,
      evidence_count: repeatedTraffic,
      severity: "warning",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedLighting = evaluations.filter((evaluation) => evaluation.issue_category === "lighting_environment").length;
  if (repeatedLighting >= 2) {
    signals.push({
      key: "repeated_lighting_environment",
      label: "Recurring lighting or environment issue",
      detail: `${repeatedLighting} recent comparable shoots reported lighting or environment friction.`,
      evidence_count: repeatedLighting,
      severity: "warning",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedSchoolReadiness = evaluations.filter(
    (evaluation) => evaluation.customer_school_readiness === "minor_friction" || evaluation.customer_school_readiness === "major_friction"
  ).length;
  if (repeatedSchoolReadiness >= 2) {
    signals.push({
      key: "repeated_school_readiness",
      label: "Recurring school readiness problem",
      detail: `${repeatedSchoolReadiness} recent comparable shoots ran into site-readiness friction.`,
      evidence_count: repeatedSchoolReadiness,
      severity: "high",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedLateStarts = evaluations.filter(
    (evaluation) => evaluation.started_on_time === false || evaluation.on_time === "No"
  ).length;
  if (repeatedLateStarts >= 2) {
    signals.push({
      key: "repeated_late_start",
      label: "Repeated late starts",
      detail: `${repeatedLateStarts} recent comparable shoots did not start on time.`,
      evidence_count: repeatedLateStarts,
      severity: "warning",
      source: "repeated_structured_pattern"
    });
  }

  const repeatedProductionIssues = evaluations.filter((evaluation) => evaluation.issue_category === "special_product_deliverable_issue").length;
  if (repeatedProductionIssues >= 2) {
    signals.push({
      key: "repeated_production_release_issue",
      label: "Recurring production or release issue",
      detail: `${repeatedProductionIssues} recent comparable shoots flagged specialty deliverable or release follow-up.`,
      evidence_count: repeatedProductionIssues,
      severity: "high",
      source: "repeated_structured_pattern"
    });
  }

  return signals
    .sort((left, right) => {
      const severityRank = { high: 0, warning: 1, info: 2 } as const;
      const severityDelta = severityRank[left.severity] - severityRank[right.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return right.evidence_count - left.evidence_count;
    })
    .slice(0, 3);
}

function buildHistoricalFollowUps(input: {
  evaluations: ShootLocationEvaluation[];
  proposedNotes: Awaited<ReturnType<typeof listLocationMemoryNotesForLocation>>["notes"];
  photos: ShootLocationPhoto[];
}) {
  const followUps: Array<{
    id: string;
    type: "eval_follow_up" | "memory_review" | "photo_review";
    title: string;
    detail: string;
    related_shoot_name: string | null;
    related_shoot_date: string | null;
    created_at: string | null;
    source_label: string;
  }> = [];

  for (const evaluation of input.evaluations) {
    if (!evaluation.follow_up_required && !evaluation.major_issue_flag && !evaluation.customer_follow_up_needed && !evaluation.leadership_review_needed) {
      continue;
    }
    if (evaluation.eval_status === "closed") {
      continue;
    }
    followUps.push({
      id: `eval:${evaluation.id}`,
      type: "eval_follow_up",
      title: evaluation.leadership_review_needed
        ? "Leadership review still needed"
        : evaluation.customer_follow_up_needed
          ? "Customer or school follow-up still matters"
          : "Post-shoot follow-up is still open",
      detail:
        evaluation.next_time_recommendation ??
        evaluation.top_watch_out ??
        evaluation.short_summary_note ??
        evaluation.recommendations ??
        "A recent post-shoot eval still needs follow-up before the next visit.",
      related_shoot_name: evaluation.shoot_name,
      related_shoot_date: evaluation.shoot_date,
      created_at: evaluation.reviewed_at ?? evaluation.created_at,
      source_label: "Post-Shoot Eval"
    });
  }

  for (const note of input.proposedNotes) {
    followUps.push({
      id: `memory:${note.id}`,
      type: "memory_review",
      title: "Location memory review pending",
      detail: note.body,
      related_shoot_name: null,
      related_shoot_date: null,
      created_at: note.updated_at ?? note.created_at,
      source_label: "Location Memory Suggestion"
    });
  }

  for (const photo of input.photos) {
    if (!photo.promote_to_location_memory || photo.memory_state === "added_to_memory") {
      continue;
    }
    followUps.push({
      id: `photo:${photo.id}`,
      type: "photo_review",
      title: "Setup photo still needs memory review",
      detail: photo.caption,
      related_shoot_name: null,
      related_shoot_date: null,
      created_at: photo.reviewed_at ?? photo.uploaded_at,
      source_label: "Setup Photo Set"
    });
  }

  return followUps
    .sort((left, right) => new Date(right.created_at ?? 0).getTime() - new Date(left.created_at ?? 0).getTime())
    .slice(0, 5);
}

function collectTopWatchOuts(input: {
  locationMemory: ReturnType<typeof buildLocationMemorySummary>;
  evaluations: ShootLocationEvaluation[];
  patternSignals: Array<{ label: string }>;
}) {
  const values: string[] = [];
  const push = (value?: string | null) => {
    const trimmed = value?.trim();
    if (!trimmed) {
      return;
    }
    if (!values.includes(trimmed)) {
      values.push(trimmed);
    }
  };

  push(input.locationMemory.top_watch_out);
  for (const evaluation of input.evaluations.slice(0, 3)) {
    push(evaluation.top_watch_out);
    push(evaluation.next_time_recommendation);
  }
  for (const signal of input.patternSignals.slice(0, 2)) {
    push(signal.label);
  }

  return values.slice(0, 3);
}

function prioritizeHistoricalPhotos(photos: ShootLocationPhoto[]) {
  const categoryRank: Record<string, number> = {
    arrival_entrance: 0,
    parking_load_in: 1,
    room_wide_shot: 2,
    final_camera_background_setup: 3,
    check_in_flow_area: 4,
    power_staging_storage: 5,
    special_constraint_watch_out: 6
  };

  return [...photos].sort((left, right) => {
    const leftSourceRank = left.source === "catalog" ? 1 : 0;
    const rightSourceRank = right.source === "catalog" ? 1 : 0;
    if (leftSourceRank !== rightSourceRank) {
      return leftSourceRank - rightSourceRank;
    }
    const leftCategoryRank = left.photo_category ? (categoryRank[left.photo_category] ?? 99) : 99;
    const rightCategoryRank = right.photo_category ? (categoryRank[right.photo_category] ?? 99) : 99;
    if (leftCategoryRank !== rightCategoryRank) {
      return leftCategoryRank - rightCategoryRank;
    }
    const leftReviewed = left.memory_state === "added_to_memory" ? 0 : left.memory_state === "reviewed" ? 1 : 2;
    const rightReviewed = right.memory_state === "added_to_memory" ? 0 : right.memory_state === "reviewed" ? 1 : 2;
    if (leftReviewed !== rightReviewed) {
      return leftReviewed - rightReviewed;
    }
    return new Date(right.uploaded_at ?? 0).getTime() - new Date(left.uploaded_at ?? 0).getTime();
  });
}

function canReviewLocationKnowledge(auth: AuthUser) {
  return !isFieldRole(auth) && (hasAuthorityTier(auth, ["super_admin", "leadership", "director_admin", "supervisor"]) || auth.permissions.includes("shoot.update"));
}

function toProxyableImageUrl(url: string) {
  if (isMondayProtectedImageUrl(url)) {
    return `/api/locations/photo-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function groupBy<TItem>(items: TItem[], keyFn: (item: TItem) => string) {
  const grouped = new Map<string, TItem[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = grouped.get(key);
    if (existing) {
      existing.push(item);
    } else {
      grouped.set(key, [item]);
    }
  }
  return grouped;
}

export async function getShootLocationIntelligence(
  client: PoolClient,
  auth: AuthUser,
  input: {
    shootId?: string | null;
    outlookEventId?: string | null;
    outlookCalendarId?: string | null;
    shootCode?: string | null;
    eventSubject?: string | null;
    eventLocation?: string | null;
    shootLocationName?: string | null;
    shootLocationAddress?: string | null;
  }
): Promise<ShootLocationIntelligence> {
  if (input.shootId) {
    await assertShootAccess(client, auth, input.shootId);
  }

  const dataset = await loadLocationDataset(client, auth.tenantId);
  const linked = await loadLocationLink(client, auth.tenantId, input.shootId ?? null, input.outlookEventId ?? null);
  let matchedLocationId = linked?.location_id ?? null;
  let matchSource: ShootLocationIntelligence["match_source"] = linked ? "manual" : "none";
  let confidence = Number(linked?.confidence ?? 0);

  const suggestions = await findLocationCandidates(client, auth.tenantId, {
    eventSubject: input.eventSubject,
    eventLocation: input.eventLocation,
    shootLocationName: input.shootLocationName,
    shootLocationAddress: input.shootLocationAddress
  });

  if (!matchedLocationId) {
    const best = suggestions[0];
    if (best && best.confidence >= 0.55) {
      matchedLocationId = best.location_id;
      matchSource =
        normalizeLocationText(input.shootLocationName) === normalizeLocationText(best.name)
          ? "shoot"
          : normalizeLocationText(input.eventLocation) === normalizeLocationText(best.name)
            ? "event_location"
            : "fuzzy";
      confidence = best.confidence;
    }
  }

  const locationMemory = matchedLocationId ? await listLocationMemoryNotesForLocation(client, auth, matchedLocationId, { limit: 8 }) : null;
  const summary = matchedLocationId ? dataset.summaryById.get(matchedLocationId) ?? null : null;
  const record = matchedLocationId ? dataset.recordById.get(matchedLocationId) ?? null : null;
  const recentEvaluations = matchedLocationId ? (dataset.evaluationsByLocationId.get(matchedLocationId) ?? []).slice(0, 5) : [];
  const recentPhotos =
    matchedLocationId && record ? buildPhotoGallery(record, dataset.photosByLocationId.get(matchedLocationId) ?? []).slice(0, 6) : [];
  const missingAlert = input.shootId ? await loadMissingSetupPhotoAlert(client, input.shootId) : null;
  const locationMemorySummary =
    summary && locationMemory
      ? buildLocationMemorySummary({
          detail: summary,
          memoryNotes: locationMemory.notes,
          recentPhotos,
          evaluations: recentEvaluations
        })
      : null;

  return {
    shoot_id: input.shootId ?? null,
    outlook_event_id: input.outlookEventId ?? null,
    shoot_code: input.shootCode ?? null,
    matched_location_id: matchedLocationId,
    match_source: matchSource,
    confidence,
    location: summary,
    recent_evaluations: recentEvaluations,
    recent_photos: recentPhotos,
    suggestions,
    missing_setup_photo_alert: missingAlert,
    historical_context:
      summary && locationMemory && locationMemorySummary
        ? buildHistoricalContext({
            summary,
            locationMemory: locationMemorySummary,
            memoryNotes: locationMemory.notes,
            evaluations: recentEvaluations,
            photos: recentPhotos
          })
        : null
  };
}

export async function enrichOutlookEventsWithLocationIntelligence<TEvent extends {
  id: string;
  calendar_id: string;
  subject: string;
  location: string;
  shoot_id?: string | null;
  shoot_code?: string | null;
}>(
  client: PoolClient,
  auth: AuthUser,
  events: TEvent[]
): Promise<Array<TEvent & { shoot_id?: string | null; location_intelligence: OutlookLocationPreview }>> {
  const dataset = await loadLocationDataset(client, auth.tenantId);
  const shootRows = await loadRelevantShoots(client, auth.tenantId, events.map((event) => event.shoot_code ?? null));
  const shootByCode = new Map(shootRows.map((row) => [row.shoot_code, row]));
  const locationLinks = await loadLocationLinksByEventIds(client, auth.tenantId, events.map((event) => event.id));
  const shootAlertMap = new Map<string, LocationComplianceAlert | null>();
  const enriched: Array<TEvent & { shoot_id?: string | null; location_intelligence: OutlookLocationPreview }> = [];

  for (const event of events) {
    const shoot = event.shoot_code ? shootByCode.get(event.shoot_code) ?? null : null;
    const linked = locationLinks.get(event.id) ?? (shoot?.id ? await loadLocationLink(client, auth.tenantId, shoot.id, null) : null);
    const candidates = await findLocationCandidates(client, auth.tenantId, {
      eventSubject: event.subject,
      eventLocation: event.location,
      shootLocationName: shoot?.location_name ?? null,
      shootLocationAddress: shoot?.location_address ?? null
    });
    const matchedLocationId =
      linked?.location_id ??
      (candidates[0] && candidates[0].confidence >= 0.55 ? candidates[0].location_id : null);
    const summary = matchedLocationId ? dataset.summaryById.get(matchedLocationId) ?? null : null;
    let warningAlertOpen = false;
    if (shoot?.id) {
      if (!shootAlertMap.has(shoot.id)) {
        shootAlertMap.set(shoot.id, await loadMissingSetupPhotoAlert(client, shoot.id));
      }
      warningAlertOpen = Boolean(shootAlertMap.get(shoot.id));
    }

    enriched.push({
      ...event,
      shoot_id: event.shoot_id ?? shoot?.id ?? null,
      location_intelligence: {
        matched_location_id: matchedLocationId,
        match_source: linked ? "manual" : matchedLocationId ? "fuzzy" : "none",
        confidence: Number(linked?.confidence ?? candidates[0]?.confidence ?? 0),
        matched_location_name: summary?.name ?? null,
        matched_location_address: summary?.address ?? null,
        setup_photo_count: summary?.photo_count ?? 0,
        evaluation_count: summary?.stats.evaluation_count ?? 0,
        avg_rating: summary?.stats.avg_rating ?? null,
        on_time_percent: summary?.stats.on_time_percent ?? 0,
        easy_access_percent: summary?.stats.easy_access_percent ?? 0,
        latest_recommendation:
          summary?.latest_recommendation ??
          (matchedLocationId ? dataset.evaluationsByLocationId.get(matchedLocationId)?.[0]?.recommendations ?? null : null),
        suggestions: candidates,
        warning_alert_open: warningAlertOpen
      }
    });
  }

  return enriched;
}

export async function submitShootLocationEvaluation(
  client: PoolClient,
  auth: AuthUser,
  input: EvaluationSubmitInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  if (input.shoot_id) {
    await assertShootAccess(client, auth, input.shoot_id);
  }

  const location = await getLocationRecordById(client, auth.tenantId, input.location_id);
  if (!location) {
    throw new ApiError(404, "Location not found");
  }

  const syncOperation = await queueIntegrationSyncOperation(client, {
    tenantId: auth.tenantId,
    provider: "monday",
    direction: "outbound",
    entityType: "post_shoot_evaluation",
    externalObjectType: "monday_item",
    operationType: "create",
    sourceSystem: "mission_control",
    sourceChangeKey: `post_shoot_evaluation:${input.location_id}:${input.shoot_date}:${auth.id}:${Date.now()}`,
    triggeredByUserId: auth.id,
    payload: {
      location_id: input.location_id,
      shoot_id: input.shoot_id ?? null,
      outlook_event_id: input.outlook_event_id ?? null,
      shoot_name: input.shoot_name,
      shoot_date: input.shoot_date
    }
  });

  let mondayResult: Awaited<ReturnType<typeof createMondayEvaluation>>;
  try {
    mondayResult = await createMondayEvaluation(input);
    await markIntegrationSyncOperationSucceeded(client, {
      tenantId: auth.tenantId,
      operationId: syncOperation.id,
      actorUserId: auth.id,
      externalId: mondayResult.monday_item_id ?? null,
      resultPayload: mondayResult.raw_payload as Record<string, unknown>,
      metadata: {
        location_id: input.location_id,
        shoot_id: input.shoot_id ?? null
      }
    });
  } catch (error) {
    await markIntegrationSyncOperationFailed(client, {
      tenantId: auth.tenantId,
      operationId: syncOperation.id,
      actorUserId: auth.id,
      errorMessage: error instanceof Error ? error.message : "Monday evaluation sync failed",
      resultPayload: {
        location_id: input.location_id,
        shoot_id: input.shoot_id ?? null
      }
    });
    throw error;
  }
  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO post_shoot_evaluation (
        tenant_id,
        location_id,
        shoot_id,
        outlook_event_id,
        monday_item_id,
        shoot_name,
        shoot_date,
        photographer_user_id,
        photographer_name,
        shoot_type,
        on_time,
        easy_access,
        overall_rating,
        photos_uploaded,
        late_details,
        access_details,
        notes,
        outreach_notes,
        recommendations,
        image_quality,
        submitted_by_user_id,
        source,
        raw_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'mission_control',$22::jsonb)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.location_id,
      input.shoot_id ?? null,
      input.outlook_event_id ?? null,
      mondayResult.monday_item_id,
      input.shoot_name,
      input.shoot_date,
      auth.id,
      input.photographer_name,
      input.shoot_type,
      input.on_time,
      input.easy_access,
      input.overall_rating,
      input.photos_uploaded,
      input.late_details ?? null,
      input.access_details ?? null,
      input.notes ?? null,
      input.outreach_notes ?? null,
      input.recommendations ?? null,
      input.image_quality ?? null,
      auth.id,
      JSON.stringify(mondayResult.raw_payload)
    ]
  );
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.evaluation.submitted",
    entityType: "post_shoot_evaluation",
    entityId: rows[0].id,
    metadata: {
      location_id: input.location_id,
      shoot_id: input.shoot_id ?? null,
      outlook_event_id: input.outlook_event_id ?? null,
      monday_item_id: mondayResult.monday_item_id,
      overall_rating: input.overall_rating,
      photos_uploaded: input.photos_uploaded
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  if (input.shoot_id && input.photos_uploaded === "No") {
    const shoot = await loadShootById(client, input.shoot_id);
    if (shoot) {
      await ensureMissingSetupPhotoAlert(client, auth.tenantId, shoot, auth.id, "Evaluation marked photos uploaded as No.");
    }
  }

  return getShootLocationDetail(client, auth, input.location_id);
}

export async function uploadShootLocationPhoto(
  client: PoolClient,
  auth: AuthUser,
  input: SetupPhotoUploadInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  if (input.shoot_id) {
    await assertShootAccess(client, auth, input.shoot_id);
  }

  const location = await getLocationRecordById(client, auth.tenantId, input.location_id);
  if (!location) {
    throw new ApiError(404, "Location not found");
  }

  const parsed = parseDataUrl(input.data_url, input.content_type);
  const syncOperation = await queueIntegrationSyncOperation(client, {
    tenantId: auth.tenantId,
    provider: "monday",
    direction: "outbound",
    entityType: "setup_photo_upload",
    externalObjectType: "monday_asset",
    operationType: "create",
    sourceSystem: "mission_control",
    sourceChangeKey: `setup_photo_upload:${input.location_id}:${auth.id}:${Date.now()}`,
    triggeredByUserId: auth.id,
    payload: {
      location_id: input.location_id,
      shoot_id: input.shoot_id ?? null,
      outlook_event_id: input.outlook_event_id ?? null,
      file_name: input.file_name
    }
  });

  let mondayResult: Awaited<ReturnType<typeof uploadMondayLocationPhoto>>;
  try {
    mondayResult = await uploadMondayLocationPhoto(
      [
        {
          ...buildEmptySummary(location),
          stats: { avg_rating: null, on_time_percent: 0, easy_access_percent: 0, evaluation_count: 0, setup_photo_count: 0 },
          photo_count: location.photo_urls.length,
          area_count: 0,
          latest_recommendation: null
        }
      ],
      {
        ...input,
        location_name: location.name,
        file_bytes: parsed.buffer
      }
    );
    await markIntegrationSyncOperationSucceeded(client, {
      tenantId: auth.tenantId,
      operationId: syncOperation.id,
      actorUserId: auth.id,
      externalId: mondayResult.monday_asset_id ?? mondayResult.monday_item_id ?? null,
      resultPayload: mondayResult.raw_payload as Record<string, unknown>,
      metadata: {
        location_id: input.location_id,
        shoot_id: input.shoot_id ?? null,
        monday_item_id: mondayResult.monday_item_id ?? null
      }
    });
  } catch (error) {
    await markIntegrationSyncOperationFailed(client, {
      tenantId: auth.tenantId,
      operationId: syncOperation.id,
      actorUserId: auth.id,
      errorMessage: error instanceof Error ? error.message : "Monday setup photo sync failed",
      resultPayload: {
        location_id: input.location_id,
        shoot_id: input.shoot_id ?? null,
        file_name: input.file_name
      }
    });
    throw error;
  }

  const { rows } = await client.query<{ id: string }>(
    `
      INSERT INTO setup_photo_upload (
        tenant_id,
        location_id,
        shoot_id,
        outlook_event_id,
        monday_item_id,
        monday_asset_id,
        uploader_user_id,
        uploader_name,
        file_name,
        photo_category,
        caption,
        promote_to_location_memory,
        memory_state,
        content_type,
        image_url,
        source,
        uploaded_at,
        raw_payload
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::setup_photo_memory_state,$14,$15,'mission_control',now(),$16::jsonb)
      RETURNING id
    `,
    [
      auth.tenantId,
      input.location_id,
      input.shoot_id ?? null,
      input.outlook_event_id ?? null,
      mondayResult.monday_item_id,
      mondayResult.monday_asset_id,
      auth.id,
      auth.fullName,
      input.file_name,
      input.photo_category ?? null,
      input.caption?.trim() || input.file_name,
      Boolean(input.promote_to_location_memory),
      "submitted",
      input.content_type,
      mondayResult.image_url,
      JSON.stringify({
        ...mondayResult.raw_payload,
        photo_category: input.photo_category ?? null,
        caption: input.caption?.trim() || input.file_name,
        promote_to_location_memory: Boolean(input.promote_to_location_memory)
      })
    ]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.setup_photo.uploaded",
    entityType: "setup_photo_upload",
    entityId: rows[0].id,
    metadata: {
      location_id: input.location_id,
      shoot_id: input.shoot_id ?? null,
      outlook_event_id: input.outlook_event_id ?? null,
      monday_item_id: mondayResult.monday_item_id,
      monday_asset_id: mondayResult.monday_asset_id
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  await upsertResourceLibraryItemFromSource(client, {
    tenantId: auth.tenantId,
    organizationId: location.organization_id ?? null,
    locationId: input.location_id,
    shootId: input.shoot_id ?? null,
    uploaderUserId: auth.id,
    uploaderName: auth.fullName,
    resourceType: "image",
    category: "setup_photo",
    approvalStatus: "approved",
    visibilityScope: "photographer_prep",
    note: input.caption?.trim() || input.file_name,
    issueType: input.photo_category ?? null,
    fileName: input.file_name,
    contentType: input.content_type,
    fileUrl: mondayResult.image_url,
    uploadSource: "web_upload",
    capturedAt: null,
    sourceRecordType: "setup_photo_upload",
    sourceRecordId: rows[0].id
  });

  if (input.shoot_id) {
    const openAlert = await loadMissingSetupPhotoAlert(client, input.shoot_id);
    if (openAlert) {
      await resolveLocationAlert(client, openAlert.id, auth.id, "Cleared automatically after a setup photo upload.", {
        auto_cleared: true
      });
    }
  }

  return getShootLocationDetail(client, auth, input.location_id);
}

export async function reviewShootLocationEvaluation(
  client: PoolClient,
  auth: AuthUser,
  input: {
    evaluationId: string;
    evalStatus: "reviewed" | "closed";
    note?: string | null;
  },
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  if (!canReviewLocationKnowledge(auth)) {
    throw new ApiError(403, "Only managers, coordinators, leadership, or admins can review post-shoot evaluations.");
  }

  const current = await client.query<{ id: string; tenant_id: string; location_id: string; eval_status: string | null }>(
    `
      SELECT id, tenant_id, location_id::text, eval_status::text
      FROM post_shoot_evaluation
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.evaluationId]
  );
  const row = current.rows[0];
  if (!row) {
    throw new ApiError(404, "Post-shoot evaluation not found.");
  }

  const result = await client.query<{ location_id: string }>(
    `
      UPDATE post_shoot_evaluation
      SET
        eval_status = $3::post_shoot_eval_status,
        reviewed_at = CASE WHEN $3::post_shoot_eval_status IN ('reviewed', 'closed') THEN now() ELSE reviewed_at END,
        reviewed_by_user_id = CASE WHEN $3::post_shoot_eval_status IN ('reviewed', 'closed') THEN $4 ELSE reviewed_by_user_id END,
        review_note = COALESCE($5, review_note),
        closed_at = CASE WHEN $3::post_shoot_eval_status = 'closed' THEN now() ELSE closed_at END,
        closed_by_user_id = CASE WHEN $3::post_shoot_eval_status = 'closed' THEN $4 ELSE closed_by_user_id END,
        close_note = CASE WHEN $3::post_shoot_eval_status = 'closed' THEN COALESCE($5, close_note) ELSE close_note END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING location_id::text
    `,
    [auth.tenantId, input.evaluationId, input.evalStatus, auth.id, input.note?.trim() || null]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: input.evalStatus === "closed" ? "location.evaluation.closed" : "location.evaluation.reviewed",
    entityType: "post_shoot_evaluation",
    entityId: input.evaluationId,
    metadata: {
      prior_eval_status: row.eval_status ?? null,
      next_eval_status: input.evalStatus,
      note: input.note?.trim() || null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getShootLocationDetail(client, auth, result.rows[0].location_id);
}

export async function reviewShootLocationPhoto(
  client: PoolClient,
  auth: AuthUser,
  input: {
    photoId: string;
    memoryState: "reviewed" | "added_to_memory";
    note?: string | null;
  },
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  if (!canReviewLocationKnowledge(auth)) {
    throw new ApiError(403, "Only managers, coordinators, leadership, or admins can review setup photo sets.");
  }

  const current = await client.query<{ id: string; location_id: string; memory_state: string | null }>(
    `
      SELECT id, location_id::text, memory_state::text
      FROM setup_photo_upload
      WHERE tenant_id = $1
        AND id = $2
      LIMIT 1
    `,
    [auth.tenantId, input.photoId]
  );
  const row = current.rows[0];
  if (!row) {
    throw new ApiError(404, "Setup photo not found.");
  }

  const result = await client.query<{ location_id: string }>(
    `
      UPDATE setup_photo_upload
      SET
        memory_state = $3::setup_photo_memory_state,
        reviewed_at = CASE WHEN $3::setup_photo_memory_state IN ('reviewed', 'added_to_memory') THEN now() ELSE reviewed_at END,
        reviewed_by_user_id = CASE WHEN $3::setup_photo_memory_state IN ('reviewed', 'added_to_memory') THEN $4 ELSE reviewed_by_user_id END,
        review_note = COALESCE($5, review_note),
        added_to_memory_at = CASE WHEN $3::setup_photo_memory_state = 'added_to_memory' THEN now() ELSE added_to_memory_at END,
        added_to_memory_by_user_id = CASE WHEN $3::setup_photo_memory_state = 'added_to_memory' THEN $4 ELSE added_to_memory_by_user_id END,
        updated_at = now()
      WHERE tenant_id = $1
        AND id = $2
      RETURNING location_id::text
    `,
    [auth.tenantId, input.photoId, input.memoryState, auth.id, input.note?.trim() || null]
  );

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: input.memoryState === "added_to_memory" ? "location.setup_photo.added_to_memory" : "location.setup_photo.reviewed",
    entityType: "setup_photo_upload",
    entityId: input.photoId,
    metadata: {
      prior_memory_state: row.memory_state ?? null,
      next_memory_state: input.memoryState,
      note: input.note?.trim() || null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getShootLocationDetail(client, auth, result.rows[0].location_id);
}

export async function linkShootLocation(
  client: PoolClient,
  auth: AuthUser,
  input: {
    location_id: string;
    shoot_id?: string | null;
    outlook_event_id?: string | null;
    outlook_calendar_id?: string | null;
    shoot_code?: string | null;
    event_subject?: string | null;
    event_location?: string | null;
    confidence?: number | null;
  },
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  if (input.shoot_id) {
    await assertShootAccess(client, auth, input.shoot_id);
  }

  const baseValues = [
    auth.tenantId,
    input.shoot_id ?? null,
    input.outlook_event_id ?? null,
    input.outlook_calendar_id ?? null,
    input.shoot_code ?? null,
    input.event_subject ?? null,
    input.event_location ?? null,
    input.location_id,
    input.confidence ?? 1,
    auth.id
  ];

  let rowId = "";
  if (input.shoot_id) {
    const { rows } = await client.query<{ id: string }>(
      `
        INSERT INTO shoot_location_link (
          tenant_id, shoot_id, outlook_event_id, outlook_calendar_id, shoot_code, event_subject, event_location,
          location_id, match_status, match_source, confidence, linked_by_user_id, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'matched','manual',$9,$10,now())
        ON CONFLICT (tenant_id, shoot_id)
        WHERE shoot_id IS NOT NULL
        DO UPDATE SET
          outlook_event_id = COALESCE(EXCLUDED.outlook_event_id, shoot_location_link.outlook_event_id),
          outlook_calendar_id = COALESCE(EXCLUDED.outlook_calendar_id, shoot_location_link.outlook_calendar_id),
          shoot_code = COALESCE(EXCLUDED.shoot_code, shoot_location_link.shoot_code),
          event_subject = COALESCE(EXCLUDED.event_subject, shoot_location_link.event_subject),
          event_location = COALESCE(EXCLUDED.event_location, shoot_location_link.event_location),
          location_id = EXCLUDED.location_id,
          match_status = 'matched',
          match_source = 'manual',
          confidence = EXCLUDED.confidence,
          linked_by_user_id = EXCLUDED.linked_by_user_id,
          updated_at = now()
        RETURNING id
      `,
      baseValues
    );
    rowId = rows[0].id;
  } else if (input.outlook_event_id) {
    const { rows } = await client.query<{ id: string }>(
      `
        INSERT INTO shoot_location_link (
          tenant_id, shoot_id, outlook_event_id, outlook_calendar_id, shoot_code, event_subject, event_location,
          location_id, match_status, match_source, confidence, linked_by_user_id, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'matched','manual',$9,$10,now())
        ON CONFLICT (tenant_id, outlook_event_id)
        WHERE outlook_event_id IS NOT NULL
        DO UPDATE SET
          shoot_id = COALESCE(EXCLUDED.shoot_id, shoot_location_link.shoot_id),
          outlook_calendar_id = COALESCE(EXCLUDED.outlook_calendar_id, shoot_location_link.outlook_calendar_id),
          shoot_code = COALESCE(EXCLUDED.shoot_code, shoot_location_link.shoot_code),
          event_subject = COALESCE(EXCLUDED.event_subject, shoot_location_link.event_subject),
          event_location = COALESCE(EXCLUDED.event_location, shoot_location_link.event_location),
          location_id = EXCLUDED.location_id,
          match_status = 'matched',
          match_source = 'manual',
          confidence = EXCLUDED.confidence,
          linked_by_user_id = EXCLUDED.linked_by_user_id,
          updated_at = now()
        RETURNING id
      `,
      baseValues
    );
    rowId = rows[0].id;
  } else {
    throw new ApiError(400, "A shoot or Outlook event must be provided to save a location link");
  }

  if (input.event_location) {
    await client.query(
      `
        INSERT INTO shoot_location_alias (tenant_id, location_id, alias, normalized_alias, source, created_by_user_id, updated_at)
        VALUES ($1,$2,$3,$4,'manual_link',$5,now())
        ON CONFLICT (tenant_id, normalized_alias)
        DO UPDATE SET location_id = EXCLUDED.location_id, source = EXCLUDED.source, created_by_user_id = EXCLUDED.created_by_user_id, updated_at = now()
      `,
      [auth.tenantId, input.location_id, input.event_location, normalizeLocationText(input.event_location), auth.id]
    );
  }

  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.link.saved",
    entityType: "shoot_location_link",
    entityId: rowId,
    metadata: {
      location_id: input.location_id,
      shoot_id: input.shoot_id ?? null,
      outlook_event_id: input.outlook_event_id ?? null,
      event_location: input.event_location ?? null
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });

  return getShootLocationIntelligence(client, auth, {
    shootId: input.shoot_id ?? null,
    outlookEventId: input.outlook_event_id ?? null,
    outlookCalendarId: input.outlook_calendar_id ?? null,
    shootCode: input.shoot_code ?? null,
    eventSubject: input.event_subject ?? null,
    eventLocation: input.event_location ?? null
  });
}

export async function overrideMissingSetupPhotoAlert(
  client: PoolClient,
  auth: AuthUser,
  input: {
    alertId: string;
    reason: string;
  },
  meta: { ipAddress?: string | null; userAgent?: string | null } = {}
) {
  const alert = await resolveLocationAlert(client, input.alertId, auth.id, input.reason, { override: true });
  await createAuditLog(client, {
    tenantId: auth.tenantId,
    actorUserId: auth.id,
    action: "location.setup_photo_alert.overridden",
    entityType: "alert",
    entityId: input.alertId,
    metadata: {
      reason: input.reason
    },
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null
  });
  return alert;
}

export async function proxyLocationPhoto(url: string) {
  return proxyMondayProtectedImage(url);
}

async function loadLocationLink(client: PoolClient, tenantId: string, shootId: string | null, outlookEventId: string | null) {
  if (!shootId && !outlookEventId) {
    return null;
  }
  const { rows } = await client.query<LocationLinkRow>(
    `
      SELECT id, shoot_id, outlook_event_id, location_id, match_source, confidence
      FROM shoot_location_link
      WHERE tenant_id = $1
        AND (($2::uuid IS NOT NULL AND shoot_id = $2) OR ($3::text IS NOT NULL AND outlook_event_id = $3))
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [tenantId, shootId, outlookEventId]
  );
  return rows[0] ?? null;
}

async function loadLocationLinksByEventIds(client: PoolClient, tenantId: string, eventIds: string[]) {
  if (!eventIds.length) {
    return new Map<string, LocationLinkRow>();
  }
  const { rows } = await client.query<LocationLinkRow>(
    `
      SELECT id, shoot_id, outlook_event_id, location_id, match_source, confidence
      FROM shoot_location_link
      WHERE tenant_id = $1
        AND outlook_event_id = ANY($2::text[])
    `,
    [tenantId, eventIds]
  );
  return new Map(rows.filter((row) => row.outlook_event_id).map((row) => [String(row.outlook_event_id), row]));
}

async function loadRelevantShoots(client: PoolClient, tenantId: string, shootCodes: Array<string | null>) {
  const normalized = shootCodes.filter((code): code is string => Boolean(code));
  if (!normalized.length) {
    return [] as ShootRow[];
  }
  const { rows } = await client.query<ShootRow>(
    `
      SELECT id, shoot_code, title, location_name, location_address, arrival_time::text, start_time::text, end_time_est::text
      FROM shoot
      WHERE tenant_id = $1
        AND shoot_code = ANY($2::text[])
        AND deleted_at IS NULL
    `,
    [tenantId, normalized]
  );
  return rows;
}

async function loadShootById(client: PoolClient, shootId: string) {
  const { rows } = await client.query<ShootRow>(
    `
      SELECT id, shoot_code, title, location_name, location_address, arrival_time::text, start_time::text, end_time_est::text
      FROM shoot
      WHERE id = $1
        AND deleted_at IS NULL
      LIMIT 1
    `,
    [shootId]
  );
  return rows[0] ?? null;
}

async function loadMissingSetupPhotoAlert(client: PoolClient, shootId: string): Promise<LocationComplianceAlert | null> {
  const { rows } = await client.query<AlertRow>(
    `
      SELECT id, alert_type, message, status::text, created_at::text, resolved_at::text, resolution_note
      FROM alert
      WHERE shoot_id = $1
        AND alert_type = 'MISSING_SETUP_PHOTO'
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [shootId]
  );
  return rows[0] ?? null;
}

async function ensureMissingSetupPhotoAlert(
  client: PoolClient,
  tenantId: string,
  shoot: ShootRow,
  actorUserId: string | null,
  note: string
) {
  const existing = await loadMissingSetupPhotoAlert(client, shoot.id);
  if (existing) {
    return existing;
  }

  const { rows } = await client.query<{ id: string; message: string; status: string; created_at: string }>(
    `
      INSERT INTO alert (tenant_id, shoot_id, alert_type, message, metadata)
      VALUES ($1,$2,'MISSING_SETUP_PHOTO',$3,$4::jsonb)
      RETURNING id, message, status::text, created_at::text
    `,
    [
      tenantId,
      shoot.id,
      `Setup photo missing for shoot ${shoot.shoot_code}`,
      JSON.stringify({ source: "location_guide", note })
    ]
  );

  const alert = rows[0];
  await client.query(
    `
      INSERT INTO app_event (tenant_id, event_type, aggregate_type, aggregate_id, payload, dedupe_key)
      VALUES ($1,'alert.created','alert',$2,$3::jsonb,$4)
      ON CONFLICT (tenant_id, dedupe_key)
      WHERE dedupe_key IS NOT NULL
      DO NOTHING
    `,
    [
      tenantId,
      alert.id,
      JSON.stringify({
        id: alert.id,
        shoot_id: shoot.id,
        shoot_code: shoot.shoot_code,
        alert_type: "MISSING_SETUP_PHOTO",
        message: alert.message
      }),
      `alert:${alert.id}`
    ]
  );

  await createAuditLog(client, {
    tenantId,
    actorUserId,
    action: "location.setup_photo_alert.created",
    entityType: "alert",
    entityId: alert.id,
    metadata: {
      shoot_id: shoot.id,
      shoot_code: shoot.shoot_code,
      note
    }
  });

  return {
    id: alert.id,
    alert_type: "MISSING_SETUP_PHOTO",
    message: alert.message,
    status: alert.status,
    created_at: alert.created_at,
    resolved_at: null,
    resolution_note: null
  };
}

async function resolveLocationAlert(
  client: PoolClient,
  alertId: string,
  resolvedBy: string,
  resolutionNote: string,
  metadata: Record<string, unknown> = {}
) {
  const { rows } = await client.query(
    `
      UPDATE alert
      SET
        status = 'resolved',
        resolved_at = now(),
        resolved_by = $2,
        resolution_note = $3,
        metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
      WHERE id = $1
      RETURNING *
    `,
    [alertId, resolvedBy, resolutionNote, JSON.stringify(metadata)]
  );
  return rows[0] ?? null;
}

function parseDataUrl(dataUrl: string, expectedContentType: string) {
  const match = /^data:([^;]+);base64,([a-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) {
    throw new ApiError(400, "Setup photo upload requires a valid data URL");
  }
  const contentType = String(match[1]).toLowerCase();
  if (contentType !== expectedContentType.toLowerCase()) {
    throw new ApiError(400, "Setup photo upload content type did not match the image payload");
  }
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new ApiError(400, "Setup photo upload is empty");
  }
  if (buffer.length > 5 * 1024 * 1024) {
    throw new ApiError(400, "Setup photo upload exceeds the 5 MB limit");
  }
  return {
    buffer,
    contentType
  };
}
