import type { OutlookCalendar, OutlookCalendarEvent } from "../types";

export type CalendarEventFocus = "all" | "shoots" | "operations";

export type CalendarReportRow = {
  id: string;
  name: string;
  color_hex: string;
  owner_label: string | null;
  is_primary: boolean;
  visible_in_app: boolean;
  event_count: number;
  shoot_overlap_count: number;
  operations_event_count: number;
  next_event_title: string | null;
  next_event_at: string | null;
};

export function filterOutlookEvents(events: OutlookCalendarEvent[], focus: CalendarEventFocus) {
  const filtered =
    focus === "shoots"
      ? events.filter((event) => event.overlaps_with_shoots)
      : focus === "operations"
        ? events.filter((event) => !event.overlaps_with_shoots)
        : [...events];

  return filtered.sort((left, right) => new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime());
}

export function groupOutlookEvents(events: OutlookCalendarEvent[]) {
  const groups = new Map<string, OutlookCalendarEvent[]>();
  for (const event of filterOutlookEvents(events, "all")) {
    const startsAt = new Date(event.starts_at);
    const key = startsAt.toISOString().slice(0, 10);
    const existing = groups.get(key);
    if (existing) {
      existing.push(event);
    } else {
      groups.set(key, [event]);
    }
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, groupedEvents]) => ({
      dateKey,
      label: new Date(`${dateKey}T12:00:00`).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric"
      }),
      events: groupedEvents
    }));
}

export function buildCalendarReportRows(calendars: OutlookCalendar[], events: OutlookCalendarEvent[]): CalendarReportRow[] {
  return calendars
    .map((calendar) => {
      const calendarEvents = filterOutlookEvents(
        events.filter((event) => event.calendar_id === calendar.id),
        "all"
      );
      const nextEvent = calendarEvents[0] ?? null;
      const shootOverlapCount = calendarEvents.filter((event) => event.overlaps_with_shoots).length;

      return {
        id: calendar.id,
        name: calendar.name,
        color_hex: calendar.color_hex,
        owner_label: calendar.owner_label,
        is_primary: calendar.is_primary,
        visible_in_app: calendar.visible_in_app,
        event_count: calendarEvents.length,
        shoot_overlap_count: shootOverlapCount,
        operations_event_count: calendarEvents.length - shootOverlapCount,
        next_event_title: nextEvent?.subject ?? null,
        next_event_at: nextEvent?.starts_at ?? null
      };
    })
    .sort((left, right) => {
      if (left.visible_in_app !== right.visible_in_app) {
        return left.visible_in_app ? -1 : 1;
      }
      if (left.event_count !== right.event_count) {
        return right.event_count - left.event_count;
      }
      return left.name.localeCompare(right.name);
    });
}
