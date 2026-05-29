export type LocalDateOptions = {
  timeZone?: string | null;
};

function normalizeTimeZone(options?: LocalDateOptions) {
  const value = options?.timeZone?.trim();
  return value ? value : null;
}

function getLocalParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  ) as Record<string, string>;
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string) {
  const parts = getLocalParts(date, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - date.getTime();
}

function zonedDateTimeToUtc(input: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
  timeZone: string;
}) {
  const guess = new Date(Date.UTC(input.year, input.month - 1, input.day, input.hour, input.minute, input.second ?? 0));
  const offset = getTimeZoneOffsetMillis(guess, input.timeZone);
  return new Date(guess.getTime() - offset);
}

export function getLocalDateString(value: Date | string = new Date(), options?: LocalDateOptions) {
  const date = typeof value === "string" ? new Date(value) : value;
  const timeZone = normalizeTimeZone(options);
  if (!timeZone) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const parts = getLocalParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function coerceLocalDate(value: Date | string) {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`);
  }
  return new Date(value);
}

export function getLocalDayBounds(value: Date | string, options?: LocalDateOptions) {
  const timeZone = normalizeTimeZone(options);
  if (timeZone) {
    const dateString = getLocalDateString(value, { timeZone });
    const [year, month, day] = dateString.split("-").map((part) => Number(part));
    const start = zonedDateTimeToUtc({
      year,
      month,
      day,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone
    });
    const endExclusive = zonedDateTimeToUtc({
      year,
      month,
      day: day + 1,
      hour: 0,
      minute: 0,
      second: 0,
      timeZone
    });
    return { start, endExclusive };
  }

  const start = coerceLocalDate(value);
  start.setHours(0, 0, 0, 0);

  const endExclusive = new Date(start.getTime());
  endExclusive.setDate(endExclusive.getDate() + 1);

  return { start, endExclusive };
}
