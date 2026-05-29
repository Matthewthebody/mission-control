import { haversineMiles } from "./geo.js";

const STUDIO_ADDRESS = "18336 Minnetonka Blvd, Deephaven, MN 55391";
const STUDIO_LAT = 44.9419;
const STUDIO_LNG = -93.5022;
const STUDIO_GEOFENCE_METERS = 804;
const DEFAULT_SHOOT_GEOFENCE_METERS = 804;

export type StudioLocation = {
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
};

export function getStudioLocation() {
  return {
    address: STUDIO_ADDRESS,
    latitude: STUDIO_LAT,
    longitude: STUDIO_LNG,
    geofenceRadiusMeters: STUDIO_GEOFENCE_METERS
  } satisfies StudioLocation;
}

export function getDefaultShootGeofenceMeters() {
  return DEFAULT_SHOOT_GEOFENCE_METERS;
}

export function buildGoogleMapsLink(input: {
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  label?: string | null;
}) {
  if (typeof input.latitude === "number" && typeof input.longitude === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${input.latitude},${input.longitude}`;
  }
  const query = [input.label, input.address].filter(Boolean).join(" ").trim();
  if (!query) {
    return null;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function estimateDriveMinutesFromStudio(destinationLat?: number | null, destinationLng?: number | null) {
  if (typeof destinationLat !== "number" || typeof destinationLng !== "number") {
    return null;
  }
  const miles = haversineMiles(STUDIO_LAT, STUDIO_LNG, destinationLat, destinationLng);
  return Math.max(5, Math.round((miles / 35) * 60));
}

export async function geocodeAddress(_address: string) {
  return null;
}

export async function estimateDriveTime(
  _origin: { latitude: number; longitude: number },
  _destination: { latitude: number; longitude: number }
) {
  return null;
}
