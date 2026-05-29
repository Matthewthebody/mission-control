export type OutlookBusyWindow = {
  userId: string;
  email: string;
  title: string;
  startsAt: string;
  endsAt: string;
  showAs: string;
  isAllDay: boolean;
  source: "outlook_calendar";
};

export class OutlookCalendarGraphError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly options: {
      retryAfterSeconds?: number | null;
      statusCode?: number | null;
    } = {}
  ) {
    super(message);
  }
}

export function isOutlookCalendarGraphAvailable() {
  return false;
}

export async function listOutlookBusyWindowsForUsers(_input: {
  staff: Array<{ userId: string; email: string | null | undefined }>;
  startsAt: string;
  endsAt: string;
}) {
  return new Map<string, OutlookBusyWindow[]>();
}
