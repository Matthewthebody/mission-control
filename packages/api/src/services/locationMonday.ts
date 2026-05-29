import { config } from "../config.js";
import { ApiError } from "../errors/apiError.js";
import type { EvaluationSubmitInput, ShootLocationEvaluation, ShootLocationSummary, SetupPhotoUploadInput } from "../types/locations.js";
import { normalizeLocationText } from "./locationCatalog.js";

const MONDAY_GRAPHQL_URL = "https://api.monday.com/v2";
const MONDAY_FILE_URL = "https://api.monday.com/v2/file";
const LOCATION_BOARD_ID = 7848036857;
const POST_SHOOT_EVAL_BOARD_ID = 6159270943;
const LOCATION_FILE_COLUMN_ID = "file__1";
const MONDAY_REQUEST_TIMEOUT_MS = 10_000;
const MONDAY_JSON_RESPONSE_MAX_BYTES = 1_048_576;
const MONDAY_IMAGE_RESPONSE_MAX_BYTES = 8 * 1_048_576;

type MondayItem = {
  id: string;
  name: string;
  column_values?: Array<{
    id: string;
    text?: string | null;
    value?: string | null;
  }>;
};

type MondayBoardResponse = {
  data?: {
    boards?: Array<{
      items_page?: {
        items?: MondayItem[];
      };
    }>;
    create_item?: {
      id?: string | null;
    };
    add_file_to_column?: {
      id?: string | null;
    };
  };
  errors?: Array<{ message?: string }>;
};

type LocationLookupRecord = Pick<ShootLocationSummary, "id" | "name" | "address">;

const mondayEvalColumns = [
  "date",
  "short_text",
  "single_select",
  "single_select7",
  "single_select0",
  "long_text",
  "short_text2",
  "short_text67",
  "rating_mkrnafzr",
  "text_mkrn46s0",
  "color_mks1j8nt",
  "short_text5",
  "short_text66"
];

let cachedLocationBoardItems: { expiresAt: number; items: MondayItem[] } | null = null;
let cachedEvalBoardItems: { expiresAt: number; items: MondayItem[] } | null = null;

export function resetMondayLocationCaches() {
  cachedLocationBoardItems = null;
  cachedEvalBoardItems = null;
}

export function isMondayConfigured() {
  return Boolean(config.MONDAY_API_TOKEN);
}

export async function listHistoricalLocationEvaluations(locations: LocationLookupRecord[]) {
  if (!locations.length) {
    return new Map<string, ShootLocationEvaluation[]>();
  }

  if (!isMondayConfigured()) {
    return buildMockHistoricalEvaluations(locations);
  }

  try {
    const items = await listPostShootEvalItems();
    const mapped = new Map<string, ShootLocationEvaluation[]>();
    for (const item of items) {
      const evaluation = mapMondayEvaluation(item);
      if (!evaluation) {
        continue;
      }
      const match = findBestLocation(locations, evaluation.shoot_name);
      if (!match || match.confidence < 0.42) {
        continue;
      }
      const existing = mapped.get(match.location.id);
      if (existing) {
        existing.push(evaluation);
      } else {
        mapped.set(match.location.id, [evaluation]);
      }
    }

    for (const location of locations) {
      const rows = mapped.get(location.id);
      if (rows) {
        rows.sort((left, right) => new Date(right.shoot_date).getTime() - new Date(left.shoot_date).getTime());
      }
    }
    return mapped;
  } catch (error) {
    logMondayWarning("Falling back to cached mock evaluation history because Monday history could not be loaded", error);
    return buildMockHistoricalEvaluations(locations);
  }
}

export async function createMondayEvaluation(input: EvaluationSubmitInput) {
  if (!isMondayConfigured()) {
    return {
      monday_item_id: null,
      raw_payload: { mocked: true, reason: "MONDAY_API_TOKEN is not configured" }
    };
  }

  const columnValues = JSON.stringify({
    date: { date: input.shoot_date },
    short_text: input.photographer_name,
    single_select: input.shoot_type,
    single_select7: input.on_time,
    single_select0: input.easy_access,
    long_text: input.notes ?? "",
    short_text2: input.outreach_notes ?? "",
    short_text67: input.recommendations ?? "",
    rating_mkrnafzr: input.overall_rating,
    text_mkrn46s0: input.image_quality ?? "",
    color_mks1j8nt: input.photos_uploaded,
    short_text5: input.late_details ?? "",
    short_text66: input.access_details ?? ""
  });

  let payload: MondayBoardResponse;
  try {
    payload = await mondayGraphql<MondayBoardResponse>(
      `
        mutation ($boardId: ID!, $itemName: String!, $columnValues: JSON!) {
          create_item(board_id: $boardId, item_name: $itemName, column_values: $columnValues) {
            id
          }
        }
      `,
      {
        boardId: POST_SHOOT_EVAL_BOARD_ID,
        itemName: input.shoot_name,
        columnValues
      }
    );
  } catch {
    throw new ApiError(502, "Monday evaluation sync failed");
  }

  return {
    monday_item_id: payload.data?.create_item?.id ?? null,
    raw_payload: payload
  };
}

export async function uploadMondayLocationPhoto(
  locations: ShootLocationSummary[],
  input: SetupPhotoUploadInput & { location_name: string; file_bytes: Buffer }
) {
  if (!isMondayConfigured()) {
    return {
      monday_item_id: null,
      monday_asset_id: null,
      image_url: input.data_url,
      raw_payload: { mocked: true, reason: "MONDAY_API_TOKEN is not configured" }
    };
  }

  const boardItem = await findLocationBoardItem(locations, input.location_name);
  if (!boardItem) {
    return {
      monday_item_id: null,
      monday_asset_id: null,
      image_url: input.data_url,
      raw_payload: { warning: "No Monday location item matched this upload" }
    };
  }

  const formData = new FormData();
  formData.append(
    "query",
    `mutation ($file: File!) { add_file_to_column(item_id: ${boardItem.id}, column_id: "${LOCATION_FILE_COLUMN_ID}", file: $file) { id } }`
  );
  formData.append(
    "variables[file]",
    new Blob([Uint8Array.from(input.file_bytes)], { type: input.content_type }),
    input.file_name
  );

  let payload: MondayBoardResponse;
  try {
    const response = await fetch(MONDAY_FILE_URL, {
      method: "POST",
      headers: {
        Authorization: config.MONDAY_API_TOKEN
      },
      body: formData,
      signal: AbortSignal.timeout(MONDAY_REQUEST_TIMEOUT_MS),
      redirect: "error"
    });
    payload = await readMondayJsonResponse<MondayBoardResponse>(response, MONDAY_JSON_RESPONSE_MAX_BYTES);
    if (!response.ok || payload.errors?.length) {
      throw createMondayHttpError(response.status, "Monday file upload failed");
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(502, "Monday file upload failed");
  }

  return {
    monday_item_id: boardItem.id,
    monday_asset_id: payload.data?.add_file_to_column?.id ?? null,
    image_url: input.data_url,
    raw_payload: payload
  };
}

export async function proxyMondayProtectedImage(url: string) {
  if (!isApprovedMondayProtectedImageUrl(url)) {
    throw new ApiError(400, "Only Monday protected image URLs can be proxied");
  }
  if (!isMondayConfigured()) {
    throw new ApiError(503, "MONDAY_API_TOKEN is not configured");
  }

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: config.MONDAY_API_TOKEN,
        Accept: "image/*"
      },
      signal: AbortSignal.timeout(MONDAY_REQUEST_TIMEOUT_MS),
      redirect: "error"
    });
    if (!response.ok) {
      throw createMondayHttpError(response.status, "Monday image proxy failed");
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) {
      throw new ApiError(502, "Monday image proxy returned an unexpected content type");
    }

    return {
      contentType,
      buffer: await readResponseBuffer(response, MONDAY_IMAGE_RESPONSE_MAX_BYTES)
    };
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(502, "Monday image proxy failed");
  }
}

function mapMondayEvaluation(item: MondayItem): ShootLocationEvaluation | null {
  const columnMap = new Map((item.column_values ?? []).map((column) => [column.id, column.text ?? readMondayValueText(column.value)]));
  const shootName = item.name?.trim();
  if (!shootName) {
    return null;
  }

  return {
    id: `monday-${item.id}`,
    source: "monday",
    monday_item_id: item.id,
    shoot_name: shootName,
    shoot_date: columnMap.get("date") || new Date().toISOString().slice(0, 10),
    photographer_name: columnMap.get("short_text") || "Unknown photographer",
    shoot_type: columnMap.get("single_select") || "Schools",
    on_time: columnMap.get("single_select7") || "Yes",
    easy_access: columnMap.get("single_select0") || "Yes",
    overall_rating: clampRating(columnMap.get("rating_mkrnafzr")),
    photos_uploaded: columnMap.get("color_mks1j8nt") || "Yes",
    late_details: columnMap.get("short_text5") || null,
    access_details: columnMap.get("short_text66") || null,
    notes: columnMap.get("long_text") || null,
    outreach_notes: columnMap.get("short_text2") || null,
    recommendations: columnMap.get("short_text67") || null,
    image_quality: columnMap.get("text_mkrn46s0") || null,
    submitted_by_name: "Monday history",
    created_at: new Date(`${columnMap.get("date") || new Date().toISOString().slice(0, 10)}T12:00:00`).toISOString()
  };
}

export function mapMondayEvaluationRecordForTests(item: {
  id: string;
  name: string;
  column_values?: Array<{
    id: string;
    text?: string | null;
    value?: string | null;
  }>;
}) {
  return mapMondayEvaluation(item);
}

async function findLocationBoardItem(locations: ShootLocationSummary[], locationName: string) {
  const items = await listLocationBoardItems();
  const match = findBestLocation(
    items.map((item) => ({
      id: item.id,
      name: item.name,
      address: null,
      location_details: null,
      commentary: null,
      custodian_contact: null,
      category: "other" as const,
      navigation_url: null,
      latitude: null,
      longitude: null,
      estimated_drive_minutes: null,
      stats: { avg_rating: null, on_time_percent: 0, easy_access_percent: 0, evaluation_count: 0, setup_photo_count: 0 },
      photo_count: 0,
      area_count: 0,
      latest_recommendation: null
    })),
    locationName
  );

  if (match && match.confidence >= 0.45) {
    return items.find((item) => item.id === match.location.id) ?? null;
  }

  const fallback = findBestLocation(locations, locationName);
  if (!fallback) {
    return null;
  }

  return (
    items.find((item) => normalizeLocationText(item.name) === normalizeLocationText(fallback.location.name)) ??
    null
  );
}

async function listLocationBoardItems() {
  if (cachedLocationBoardItems && cachedLocationBoardItems.expiresAt > Date.now()) {
    return cachedLocationBoardItems.items;
  }

  const payload = await mondayGraphql<MondayBoardResponse>(
    `
      query ($boardId: [ID!]!) {
        boards(ids: $boardId) {
          items_page(limit: 200) {
            items {
              id
              name
            }
          }
        }
      }
    `,
    { boardId: [LOCATION_BOARD_ID] },
    { retryCount: 1 }
  );

  const items = payload.data?.boards?.[0]?.items_page?.items ?? [];
  cachedLocationBoardItems = {
    expiresAt: Date.now() + 15 * 60 * 1000,
    items
  };
  return items;
}

async function listPostShootEvalItems() {
  if (cachedEvalBoardItems && cachedEvalBoardItems.expiresAt > Date.now()) {
    return cachedEvalBoardItems.items;
  }

  const payload = await mondayGraphql<MondayBoardResponse>(
    `
      query ($boardId: [ID!]!, $columnIds: [String!]) {
        boards(ids: $boardId) {
          items_page(limit: 200) {
            items {
              id
              name
              column_values(ids: $columnIds) {
                id
                text
                value
              }
            }
          }
        }
      }
    `,
    { boardId: [POST_SHOOT_EVAL_BOARD_ID], columnIds: mondayEvalColumns },
    { retryCount: 1 }
  );

  const items = payload.data?.boards?.[0]?.items_page?.items ?? [];
  cachedEvalBoardItems = {
    expiresAt: Date.now() + 10 * 60 * 1000,
    items
  };
  return items;
}

async function mondayGraphql<T>(query: string, variables: Record<string, unknown>, options?: { retryCount?: number }) {
  if (!config.MONDAY_API_TOKEN) {
    throw new Error("MONDAY_API_TOKEN is not configured");
  }

  const retryCount = options?.retryCount ?? 0;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      const response = await fetch(MONDAY_GRAPHQL_URL, {
        method: "POST",
        headers: {
          Authorization: config.MONDAY_API_TOKEN,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(MONDAY_REQUEST_TIMEOUT_MS),
        redirect: "error"
      });

      if ((response.status === 429 || response.status >= 500) && attempt < retryCount) {
        logMondayWarning(`Retrying Monday GraphQL request after ${response.status} response`, response.status);
        await delayMilliseconds((attempt + 1) * 250);
        continue;
      }

      const payload = await readMondayJsonResponse<T & { errors?: Array<{ message?: string }> }>(
        response,
        MONDAY_JSON_RESPONSE_MAX_BYTES
      );
      if (!response.ok || payload.errors?.length) {
        throw createMondayHttpError(response.status, response.status === 429 ? "Monday rate limit exceeded" : "Monday request failed");
      }
      return payload;
    } catch (error) {
      if (attempt < retryCount && isRetryableMondayTransportError(error)) {
        logMondayWarning("Retrying Monday GraphQL request after transient transport failure", error);
        await delayMilliseconds((attempt + 1) * 250);
        continue;
      }
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(502, "Monday request failed");
    }
  }

  throw new ApiError(502, "Monday request failed");
}

function buildMockHistoricalEvaluations(locations: LocationLookupRecord[]) {
  const byLocation = new Map<string, ShootLocationEvaluation[]>();
  for (const [index, location] of locations.entries()) {
    const seedDate = new Date();
    seedDate.setDate(seedDate.getDate() - (index % 4) * 18 - 7);
    const score = 3 + (index % 3);
    byLocation.set(location.id, [
      {
        id: `mock-monday-${location.id}`,
        source: "mock_monday",
        monday_item_id: null,
        shoot_name: `${location.name} follow-up`,
        shoot_date: seedDate.toISOString().slice(0, 10),
        photographer_name: index % 2 === 0 ? "Demo Photographer" : "Demo Senior Photographer",
        shoot_type: /sports/i.test(location.name) ? "Sports" : "Schools",
        on_time: index % 3 === 0 ? "No" : "Yes",
        easy_access: index % 4 === 0 ? "No" : "Yes",
        overall_rating: score,
        photos_uploaded: "Yes",
        late_details: index % 3 === 0 ? "Late due to traffic backup near the lot." : null,
        access_details: index % 4 === 0 ? "Main entrance was locked; side door worked better." : null,
        notes: "Mock Monday history keeps prior venue context visible when the live board is unavailable.",
        outreach_notes: "Leadership thanked the site contact for a smooth recovery.",
        recommendations: "Unload at the side entrance first and keep a second backdrop ready.",
        image_quality: "Strong",
        submitted_by_name: "Monday history",
        created_at: `${seedDate.toISOString().slice(0, 10)}T18:00:00.000Z`
      }
    ]);
  }
  return byLocation;
}

function findBestLocation<TLocation extends { id: string; name: string; address: string | null }>(
  locations: TLocation[],
  rawValue: string
) {
  const target = normalizeLocationText(rawValue);
  if (!target) {
    return null;
  }

  return locations
    .map((location) => {
      const normalizedName = normalizeLocationText(location.name);
      const normalizedAddress = normalizeLocationText(location.address);
      const nameScore = scoreMatch(target, normalizedName);
      const addressScore = scoreMatch(target, normalizedAddress);
      return {
        location,
        confidence: Math.max(nameScore, addressScore)
      };
    })
    .sort((left, right) => right.confidence - left.confidence)[0];
}

function scoreMatch(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if (left.includes(right) || right.includes(left)) {
    return 0.82;
  }
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}

function readMondayValueText(value?: string | null) {
  if (!value) {
    return "";
  }
  try {
    const parsed = JSON.parse(value) as { text?: string; label?: string; rating?: number };
    if (typeof parsed.text === "string") {
      return parsed.text;
    }
    if (typeof parsed.label === "string") {
      return parsed.label;
    }
    if (typeof parsed.rating === "number") {
      return String(parsed.rating);
    }
  } catch {
    return value;
  }
  return "";
}

function clampRating(value?: string | null) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 4;
  }
  return Math.max(1, Math.min(5, Math.round(numeric)));
}

function isApprovedMondayProtectedImageUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isApprovedHost = host === "monday.com" || host.endsWith(".monday.com");
    return parsed.protocol === "https:" && isApprovedHost && parsed.pathname.startsWith("/protected_static/");
  } catch {
    return false;
  }
}

async function readMondayJsonResponse<T>(response: Response, maxBytes: number) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new ApiError(502, "Monday response had an unexpected content type");
  }

  const buffer = await readResponseBuffer(response, maxBytes);
  try {
    return JSON.parse(buffer.toString("utf8")) as T;
  } catch {
    throw new ApiError(502, "Monday response could not be parsed");
  }
}

async function readResponseBuffer(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new ApiError(502, "Monday response exceeded the maximum allowed size");
  }

  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value?.byteLength) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new ApiError(502, "Monday response exceeded the maximum allowed size");
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

function createMondayHttpError(status: number, defaultMessage: string) {
  if (status === 429) {
    return new ApiError(502, "Monday rate limit exceeded");
  }
  return new ApiError(502, defaultMessage);
}

function isRetryableMondayTransportError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      ["TimeoutError", "AbortError"].includes((error as { name?: string }).name ?? "")
  );
}

function delayMilliseconds(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function logMondayWarning(message: string, error: unknown) {
  if (config.NODE_ENV === "test") {
    return;
  }
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string" || typeof error === "number"
        ? String(error)
        : undefined;
  console.warn("[monday]", detail ? `${message}: ${detail}` : message);
}
