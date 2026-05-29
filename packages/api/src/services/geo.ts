import { classifyOperationalLocation } from "./attendanceAwareness.js";

export function haversineMiles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const angle = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(angle), Math.sqrt(1 - angle));
  return earthRadiusMiles * c;
}

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return haversineMiles(aLat, aLng, bLat, bLng) * 1609.344;
}

export function getGeofenceStatus(
  shootLat: number,
  shootLng: number,
  radiusMeters: number,
  eventLat?: number | null,
  eventLng?: number | null
): "inside" | "outside" | "unknown" {
  if (typeof eventLat !== "number" || typeof eventLng !== "number") {
    return "unknown";
  }
  return haversineMeters(shootLat, shootLng, eventLat, eventLng) <= radiusMeters ? "inside" : "outside";
}

export function evaluatePunchLocation(input: {
  targetLat: number;
  targetLng: number;
  radiusMeters: number;
  eventLat?: number | null;
  eventLng?: number | null;
  accuracyMeters?: number | null;
  isAssignedContext?: boolean;
  manualOverride?: boolean;
}) {
  if (typeof input.eventLat !== "number" || typeof input.eventLng !== "number") {
    return {
      geofenceStatus: "unknown" as const,
      gpsConfidence: "outside" as const,
      distanceMeters: null,
      distanceFeet: null,
      isInside: false,
      isLowConfidenceInside: false,
      locationClassification: "clock_in_pending_location_review" as const
    };
  }

  const distanceMeters = haversineMeters(input.targetLat, input.targetLng, input.eventLat, input.eventLng);
  const distanceFeet = distanceMeters / 0.3048;
  const accuracyMeters = typeof input.accuracyMeters === "number" ? Math.max(0, input.accuracyMeters) : 0;
  const isInside = distanceMeters <= input.radiusMeters;
  const isLowConfidenceInside = !isInside && distanceMeters <= input.radiusMeters + accuracyMeters;
  const locationClassification = classifyOperationalLocation({
    distanceMeters,
    hasCapturedLocation: true,
    isAssignedContext: input.isAssignedContext,
    manualOverride: input.manualOverride,
    lowConfidenceInside: isLowConfidenceInside
  });

  return {
    geofenceStatus: isInside ? ("inside" as const) : ("outside" as const),
    gpsConfidence: isInside ? ("normal" as const) : isLowConfidenceInside ? ("low_confidence" as const) : ("outside" as const),
    distanceMeters,
    distanceFeet,
    isInside,
    isLowConfidenceInside,
    locationClassification
  };
}
