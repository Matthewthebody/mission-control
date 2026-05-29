import type { PoolClient } from "pg";
import { buildGoogleMapsLink, estimateDriveMinutesFromStudio } from "./maps.js";

const LOCATION_CATALOG_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310519663415376430/7rfp8DWcjNUNzAGbdiAtnp/locations_aa8c134b.json";
const LOCATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CatalogLocationRecord = {
  name?: string | null;
  address?: string | null;
  location_details?: string | null;
  photo_evidence?: string | null;
  commentary?: string | null;
  custodian_contact?: string | null;
  subitems?: Array<{
    name?: string | null;
    photo_evidence?: string | null;
    location_details?: string | null;
    commentary?: string | null;
  }> | null;
};

type ShootLocationCoordinateRow = {
  location_name: string;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
};

export type ShootLocationRecord = {
  id: string;
  organization_id: string | null;
  name: string;
  address: string | null;
  location_details: string | null;
  commentary: string | null;
  custodian_contact: string | null;
  photo_urls: string[];
  latitude: number | null;
  longitude: number | null;
  navigation_url: string | null;
  estimated_drive_minutes: number | null;
  last_catalog_sync_at: string | null;
};

export type ShootLocationAreaRecord = {
  id: string;
  location_id: string;
  name: string;
  location_details: string | null;
  commentary: string | null;
  photo_urls: string[];
};

const inflightSyncs = new Map<string, Promise<void>>();

export async function ensureLocationCatalogFresh(client: PoolClient, tenantId: string) {
  const freshness = await client.query<{ latest_sync_at: string | null; count: string }>(
    `
      SELECT max(last_catalog_sync_at)::text AS latest_sync_at, count(*)::text AS count
      FROM shoot_location
      WHERE tenant_id = $1
    `,
    [tenantId]
  );

  const latestSyncAt = freshness.rows[0]?.latest_sync_at ?? null;
  const count = Number(freshness.rows[0]?.count ?? 0);
  const isFresh = latestSyncAt ? Date.now() - new Date(latestSyncAt).getTime() < LOCATION_CACHE_TTL_MS : false;
  if (count > 0 && isFresh) {
    return {
      fetchedAt: latestSyncAt,
      stale: false,
      source: "live" as const
    };
  }
  return {
    fetchedAt: latestSyncAt ?? new Date().toISOString(),
    stale: true,
    source: count > 0 ? ("stale_cache" as const) : ("empty_cache" as const)
  };
}

export async function listLocationRecords(client: PoolClient, tenantId: string): Promise<ShootLocationRecord[]> {
  const { rows } = await client.query<{
    id: string;
    organization_id: string | null;
    name: string;
    address: string | null;
    location_details: string | null;
    commentary: string | null;
    custodian_contact: string | null;
    photo_urls: unknown;
    latitude: number | null;
    longitude: number | null;
    navigation_url: string | null;
    estimated_drive_minutes: number | null;
    last_catalog_sync_at: string | null;
  }>(
    `
      SELECT
        id,
        organization_id,
        name,
        address,
        location_details,
        commentary,
        custodian_contact,
        photo_urls,
        latitude,
        longitude,
        navigation_url,
        estimated_drive_minutes,
        last_catalog_sync_at::text
      FROM shoot_location
      WHERE tenant_id = $1
      ORDER BY lower(name), lower(COALESCE(address, ''))
    `,
    [tenantId]
  );

  return rows.map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    name: row.name,
    address: row.address,
    location_details: row.location_details,
    commentary: row.commentary,
    custodian_contact: row.custodian_contact,
    photo_urls: Array.isArray(row.photo_urls) ? (row.photo_urls as string[]) : [],
    latitude: row.latitude,
    longitude: row.longitude,
    navigation_url: row.navigation_url,
    estimated_drive_minutes: row.estimated_drive_minutes,
    last_catalog_sync_at: row.last_catalog_sync_at
  }));
}

export async function getLocationRecordById(client: PoolClient, tenantId: string, locationId: string) {
  const records = await listLocationRecords(client, tenantId);
  return records.find((row) => row.id === locationId) ?? null;
}

export async function listLocationAreas(client: PoolClient, tenantId: string, locationId: string): Promise<ShootLocationAreaRecord[]> {
  const { rows } = await client.query<{
    id: string;
    location_id: string;
    name: string;
    location_details: string | null;
    commentary: string | null;
    photo_urls: unknown;
  }>(
    `
      SELECT id, location_id, name, location_details, commentary, photo_urls
      FROM shoot_location_area
      WHERE tenant_id = $1
        AND location_id = $2
      ORDER BY lower(name)
    `,
    [tenantId, locationId]
  );

  return rows.map((row) => ({
    id: row.id,
    location_id: row.location_id,
    name: row.name,
    location_details: row.location_details,
    commentary: row.commentary,
    photo_urls: Array.isArray(row.photo_urls) ? (row.photo_urls as string[]) : []
  }));
}

export async function findLocationCandidates(
  client: PoolClient,
  tenantId: string,
  input: {
    eventSubject?: string | null;
    eventLocation?: string | null;
    shootLocationName?: string | null;
    shootLocationAddress?: string | null;
  }
) {
  const locations = await listLocationRecords(client, tenantId);
  const aliasRows = await client.query<{ location_id: string; alias: string; normalized_alias: string }>(
    `
      SELECT location_id, alias, normalized_alias
      FROM shoot_location_alias
      WHERE tenant_id = $1
    `,
    [tenantId]
  );
  const aliasesByLocationId = new Map<string, string[]>();
  for (const row of aliasRows.rows) {
    const existing = aliasesByLocationId.get(row.location_id);
    if (existing) {
      existing.push(row.alias);
    } else {
      aliasesByLocationId.set(row.location_id, [row.alias]);
    }
  }

  const subject = normalizeLocationText(input.eventSubject);
  const eventLocation = normalizeLocationText(input.eventLocation);
  const shootLocationName = normalizeLocationText(input.shootLocationName);
  const shootLocationAddress = normalizeLocationText(input.shootLocationAddress);

  return locations
    .map((location) => {
      const scoreParts: Array<{ value: number; reason: string }> = [];
      const normalizedName = normalizeLocationText(location.name);
      const normalizedAddress = normalizeLocationText(location.address);
      const aliases = (aliasesByLocationId.get(location.id) ?? []).map(normalizeLocationText);

      if (shootLocationName && normalizedName === shootLocationName) {
        scoreParts.push({ value: 1, reason: "Published shoot location matches exactly." });
      } else if (eventLocation && normalizedName === eventLocation) {
        scoreParts.push({ value: 0.96, reason: "Outlook event location matches exactly." });
      } else if (shootLocationAddress && normalizedAddress && normalizedAddress === shootLocationAddress) {
        scoreParts.push({ value: 0.94, reason: "Published shoot address matches exactly." });
      } else if (eventLocation && normalizedAddress && normalizedAddress === eventLocation) {
        scoreParts.push({ value: 0.92, reason: "Outlook event location matches the saved address." });
      }

      for (const alias of aliases) {
        if (eventLocation && alias === eventLocation) {
          scoreParts.push({ value: 0.9, reason: "Manual alias matches the event location." });
        }
        if (subject && alias && subject.includes(alias)) {
          scoreParts.push({ value: 0.84, reason: "Manual alias appears in the event title." });
        }
      }

      const bestTextMatch = Math.max(
        scoreTokenOverlap(subject, normalizedName),
        scoreTokenOverlap(eventLocation, normalizedName),
        scoreTokenOverlap(subject, normalizedAddress),
        scoreTokenOverlap(eventLocation, normalizedAddress)
      );
      if (bestTextMatch > 0.45) {
        scoreParts.push({ value: bestTextMatch, reason: "Name or address tokens overlap strongly." });
      }

      const score = Math.max(0, ...scoreParts.map((entry) => entry.value));
      return {
        location_id: location.id,
        name: location.name,
        address: location.address,
        confidence: score,
        reason: scoreParts.sort((left, right) => right.value - left.value)[0]?.reason ?? "No strong match"
      };
    })
    .filter((candidate) => candidate.confidence > 0.32)
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5);
}

export function normalizeLocationText(value?: string | null) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function splitPhotoEvidence(value?: string | null) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function inferLocationCategory(input: { name: string; address?: string | null }) {
  const haystack = `${input.name} ${input.address ?? ""}`.toLowerCase();
  if (haystack.includes("studio")) {
    return "studio" as const;
  }
  if (/(stadium|arena|field|club|volleyball|football|hockey|soccer|baseball)/i.test(haystack)) {
    return "sports" as const;
  }
  if (/(school|academy|elementary|middle|high school|district|campus)/i.test(haystack)) {
    return "school" as const;
  }
  if (/(park|center|church|hall|auditorium|venue)/i.test(haystack)) {
    return "venue" as const;
  }
  return "other" as const;
}

export function isMondayProtectedImageUrl(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const isApprovedHost = host === "monday.com" || host.endsWith(".monday.com");
    return parsed.protocol === "https:" && isApprovedHost && parsed.pathname.startsWith("/protected_static/");
  } catch {
    return false;
  }
}

async function syncCatalogFromCdn(client: PoolClient, tenantId: string) {
  const response = await fetch(LOCATION_CATALOG_URL, {
    headers: {
      Accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Location catalog request failed with ${response.status}`);
  }

  const payload = (await response.json()) as CatalogLocationRecord[];
  const locationRows = Array.isArray(payload) ? payload : [];
  const coordinates = await loadShootCoordinates(client, tenantId);
  const syncedAt = new Date().toISOString();

  for (const entry of locationRows) {
    const name = entry.name?.trim();
    if (!name) {
      continue;
    }
    const address = entry.address?.trim() || null;
    const normalizedName = normalizeLocationText(name);
    const normalizedAddress = normalizeLocationText(address);
    const coordinateMatch = findCoordinateMatch(coordinates, normalizedName, normalizedAddress);
    const navigationUrl = buildGoogleMapsLink({
      latitude: coordinateMatch?.location_lat ?? null,
      longitude: coordinateMatch?.location_lng ?? null,
      address,
      label: name
    });

    const upserted = await client.query<{ id: string }>(
      `
        INSERT INTO shoot_location (
          tenant_id,
          external_source,
          external_key,
          name,
          normalized_name,
          address,
          normalized_address,
          location_details,
          commentary,
          custodian_contact,
          photo_urls,
          latitude,
          longitude,
          navigation_url,
          estimated_drive_minutes,
          catalog_raw_payload,
          last_catalog_sync_at,
          updated_at
        )
        VALUES (
          $1,'cdn',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb,$16,now()
        )
        ON CONFLICT (tenant_id, external_source, external_key) DO UPDATE SET
          name = EXCLUDED.name,
          normalized_name = EXCLUDED.normalized_name,
          address = EXCLUDED.address,
          normalized_address = EXCLUDED.normalized_address,
          location_details = EXCLUDED.location_details,
          commentary = EXCLUDED.commentary,
          custodian_contact = EXCLUDED.custodian_contact,
          photo_urls = EXCLUDED.photo_urls,
          latitude = COALESCE(EXCLUDED.latitude, shoot_location.latitude),
          longitude = COALESCE(EXCLUDED.longitude, shoot_location.longitude),
          navigation_url = EXCLUDED.navigation_url,
          estimated_drive_minutes = EXCLUDED.estimated_drive_minutes,
          catalog_raw_payload = EXCLUDED.catalog_raw_payload,
          last_catalog_sync_at = EXCLUDED.last_catalog_sync_at,
          updated_at = now()
        RETURNING id
      `,
      [
        tenantId,
        buildCatalogKey(name, address),
        name,
        normalizedName,
        address,
        normalizedAddress || null,
        entry.location_details?.trim() || null,
        entry.commentary?.trim() || null,
        entry.custodian_contact?.trim() || null,
        JSON.stringify(splitPhotoEvidence(entry.photo_evidence)),
        coordinateMatch?.location_lat ?? null,
        coordinateMatch?.location_lng ?? null,
        navigationUrl,
        estimateDriveMinutesFromStudio(coordinateMatch?.location_lat ?? null, coordinateMatch?.location_lng ?? null),
        JSON.stringify(entry),
        syncedAt
      ]
    );

    const locationId = upserted.rows[0].id;
    await client.query("DELETE FROM shoot_location_area WHERE tenant_id = $1 AND location_id = $2", [tenantId, locationId]);
    const subitems = Array.isArray(entry.subitems) ? entry.subitems : [];
    for (const subitem of subitems) {
      const subitemName = subitem.name?.trim();
      if (!subitemName) {
        continue;
      }
      await client.query(
        `
          INSERT INTO shoot_location_area (
            tenant_id,
            location_id,
            external_key,
            name,
            location_details,
            commentary,
            photo_urls,
            raw_payload,
            updated_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,now())
        `,
        [
          tenantId,
          locationId,
          buildCatalogKey(subitemName, null),
          subitemName,
          subitem.location_details?.trim() || null,
          subitem.commentary?.trim() || null,
          JSON.stringify(splitPhotoEvidence(subitem.photo_evidence)),
          JSON.stringify(subitem)
        ]
      );
    }
  }
}

function buildCatalogKey(name: string, address?: string | null) {
  return [normalizeLocationText(name), normalizeLocationText(address)].filter(Boolean).join("::");
}

async function loadShootCoordinates(client: PoolClient, tenantId: string) {
  const { rows } = await client.query<ShootLocationCoordinateRow>(
    `
      SELECT location_name, location_address, location_lat, location_lng
      FROM shoot
      WHERE tenant_id = $1
        AND deleted_at IS NULL
    `,
    [tenantId]
  );
  return rows;
}

function findCoordinateMatch(rows: ShootLocationCoordinateRow[], normalizedName: string, normalizedAddress: string) {
  const exact = rows.find((row) => normalizeLocationText(row.location_name) === normalizedName);
  if (exact) {
    return exact;
  }
  if (normalizedAddress) {
    const addressMatch = rows.find((row) => normalizeLocationText(row.location_address) === normalizedAddress);
    if (addressMatch) {
      return addressMatch;
    }
  }
  return rows.find((row) => {
    const rowName = normalizeLocationText(row.location_name);
    return rowName.includes(normalizedName) || normalizedName.includes(rowName);
  });
}

function scoreTokenOverlap(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1;
    }
  }
  return shared / Math.max(leftTokens.size, rightTokens.size);
}
