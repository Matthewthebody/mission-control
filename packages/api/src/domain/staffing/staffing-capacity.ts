import { getLocalDateString, getLocalDayBounds } from "../../utils/localDate.js";

// Pure scheduled-capacity interval math. America/Chicago for operating dates / week boundaries / DST.
// Durations are computed on absolute instants (timestamptz) so they are DST-correct; day bucketing
// clips to zoned day bounds. Missing/invalid intervals return null and are never given a duration.
// This is SCHEDULED capacity (work_shift.starts_at..ends_at), not payroll/actual hours.

export const STAFFING_CAPACITY_TIMEZONE = "America/Chicago";

export type CapacityInterval = { startMs: number; endMs: number };

/** Parse a canonical work_shift interval. Returns null for missing/invalid timing (no invented duration). */
export function parseCapacityInterval(
  startsAt: string | null | undefined,
  endsAt: string | null | undefined
): CapacityInterval | null {
  if (!startsAt || !endsAt) {
    return null;
  }
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return null;
  }
  return { startMs, endMs };
}

export function durationMinutes(interval: CapacityInterval): number {
  return (interval.endMs - interval.startMs) / 60000;
}

/** Simple sum of all durations (overlaps double-counted) — diagnostic raw assigned minutes. */
export function rawAssignedMinutes(intervals: CapacityInterval[]): number {
  return intervals.reduce((sum, interval) => sum + durationMinutes(interval), 0);
}

/** Merge overlapping / touching intervals into a disjoint, start-sorted set. */
export function mergeIntervals(intervals: CapacityInterval[]): CapacityInterval[] {
  if (intervals.length <= 1) {
    return intervals.map((interval) => ({ ...interval }));
  }
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const merged: CapacityInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const current = sorted[i];
    if (current.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, current.endMs);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Union of overlapping intervals — the PRIMARY "scheduled capacity" total. */
export function uniqueScheduledMinutes(intervals: CapacityInterval[]): number {
  return rawAssignedMinutes(mergeIntervals(intervals));
}

/** raw - unique. Surfaced as conflict; never inflates the primary total. */
export function overlapMinutes(intervals: CapacityInterval[]): number {
  return Math.max(rawAssignedMinutes(intervals) - uniqueScheduledMinutes(intervals), 0);
}

/** Count of assignments that overlap at least one other assignment. */
export function overlapAssignmentCount(intervals: CapacityInterval[]): number {
  const sorted = intervals.map((interval, idx) => ({ ...interval, idx })).sort((a, b) => a.startMs - b.startMs);
  const overlapping = new Set<number>();
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].startMs >= sorted[i].endMs) {
        break; // sorted by start — no later interval can overlap i
      }
      overlapping.add(sorted[i].idx);
      overlapping.add(sorted[j].idx);
    }
  }
  return overlapping.size;
}

/** The America/Chicago operating date (YYYY-MM-DD) for an instant. */
export function operatingDate(ms: number): string {
  return getLocalDateString(new Date(ms), { timeZone: STAFFING_CAPACITY_TIMEZONE });
}

/**
 * Split an interval's minutes across the America/Chicago operating dates it touches. Cross-midnight
 * assignments split into the correct dates; DST spring/fall days (23h/25h) are clipped to their zoned
 * bounds, so the per-day minutes equal the actual elapsed time within each operating day.
 */
export function splitMinutesByOperatingDate(interval: CapacityInterval): Map<string, number> {
  const result = new Map<string, number>();
  let cursor = interval.startMs;
  let guard = 0;
  while (cursor < interval.endMs && guard < 800) {
    guard += 1;
    const date = operatingDate(cursor);
    const bounds = getLocalDayBounds(new Date(cursor), { timeZone: STAFFING_CAPACITY_TIMEZONE });
    const dayEnd = bounds.endExclusive.getTime();
    const segmentEnd = Math.min(interval.endMs, dayEnd);
    if (segmentEnd > cursor) {
      result.set(date, (result.get(date) ?? 0) + (segmentEnd - cursor) / 60000);
    }
    cursor = dayEnd;
  }
  return result;
}

function formatUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** Monday (the Chicago planning-week start) for a YYYY-MM-DD operating date. */
export function weekStartDate(operatingDateStr: string): string {
  const [year, month, day] = operatingDateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  return formatUtcDate(date);
}

/** Add days to a YYYY-MM-DD operating date (pure calendar arithmetic). */
export function addOperatingDays(operatingDateStr: string, days: number): string {
  const [year, month, day] = operatingDateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}
